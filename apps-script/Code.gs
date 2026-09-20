/**
 * MDM Accountability Tracker - Apps Script (single file, this is the only .gs file for this
 * project). Paste this whole file into the spreadsheet's Extensions > Apps Script editor,
 * replacing the default empty Code.gs.
 *
 * One-time setup after pasting:
 *   1. Create a sheet tab named exactly "Summary" if it doesn't exist yet.
 *   2. Run ensureSummarySheetHeader() once from the function dropdown.
 *   3. Run createTriggers() once from the same dropdown, approving the OAuth prompt.
 *   4. Project Settings (gear icon) > Script Properties > add three properties:
 *        SHARED_SECRET    - long random value, same as the frontend's APPS_SCRIPT_SHARED_SECRET
 *        APP_TOKEN_SECRET - EXACT same value as the frontend's APP_TOKEN_SECRET env var
 *                           (lets this script build a working /entry/<token> link for reminder
 *                           emails without ever calling the frontend - see the Links section)
 *        APP_BASE_URL     - the frontend's URL, e.g. https://your-app.vercel.app
 *   5. Deploy > New deployment > Web app - Execute as Me, Who has access Anyone - copy
 *      the resulting URL into the frontend's APPS_SCRIPT_URL env var.
 *   6. Run runSelfTest() and check the Execution Log for any WARNING lines - it also prints a
 *      sample entry link; compare it against what /admin shows for the same agent to confirm
 *      the token matches before trusting real reminder emails.
 *
 * Optional - automatic agent onboarding from a signup form: if you have a Google Form with
 * "Name", "Email", and "Upload Profile Photo" questions, add an "AGENT_FORM_ID" script property
 * (the form's ID from its edit URL: docs.google.com/forms/d/<THIS_PART>/edit), then re-run
 * createTriggers(). Every submission then automatically adds/updates an AGENTS row - see the
 * Agent Signup Form section. Expect a fresh OAuth consent prompt the first time this runs,
 * since it's the first use of the Drive and Forms services. If any agent's photo was saved
 * before this comment mentioned lh3.googleusercontent.com, run fixExistingProfilePhotoLinks()
 * once to upgrade it - old links were not guaranteed to render in every browser.
 *
 * To see a real email land without waiting for a real day/week/month to finish, run
 * sendTestDailyEntryReminder(), sendTestDailyEmail(), sendTestWeeklyEmail(), or
 * sendTestMonthlyEmail() - all four use fabricated sample numbers (the reminder uses a real
 * link) and are clearly marked as tests, sent to every current AGENTS email.
 */


// ============================================================
// Setup
// ============================================================

/**
 * One-time manual setup. Paste all the .gs files in this folder into
 * Extensions > Apps Script for the "MDM Accountability Tracker" spreadsheet, then:
 *   1. Create a sheet tab named exactly "Summary" (if it doesn't exist yet).
 *   2. Run ensureSummarySheetHeader() once, from the function dropdown in the editor.
 *   3. Run createTriggers() once, from the same dropdown. Approve the OAuth consent
 *      screen when prompted - the "Google hasn't verified this app" warning is expected
 *      for a script only you run; click Advanced > Go to (project name) to proceed.
 *
 * createTriggers() clears existing triggers before creating new ones, so it is always
 * safe to re-run (e.g. after editing a schedule below) without ending up with duplicate
 * triggers that would fire every function - and every email - multiple times per event.
 */
function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Keeps RESPONSE columns and Daily Total correct as soon as possible after an edit.
  ScriptApp.newTrigger('syncResponseColumns').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('recomputeAllDailyTotals').forSpreadsheet(ss).onChange().create();

  // Unconditional safety net - onChange is documented to fire for manual sheet edits, but is
  // not guaranteed to fire for edits made purely through the Web App API (e.g. from the
  // Vercel app). Node already computes Daily Total correctly at write time, so this hourly
  // pass is a redundant confirmation, not a dependency - correctness never hinges on onChange
  // firing.
  ScriptApp.newTrigger('recomputeAllDailyTotals').timeBased().everyHours(1).create();

  ScriptApp.newTrigger('sendDailyEntryReminders').timeBased()
    .everyDays(1).atHour(9).create();

  ScriptApp.newTrigger('sendDailySummaryEmails').timeBased()
    .everyDays(1).atHour(20).create();

  ScriptApp.newTrigger('weeklyRollup').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();

  ScriptApp.newTrigger('monthlyRollup').timeBased()
    .onMonthDay(1).atHour(7).create();

  var agentFormId = PropertiesService.getScriptProperties().getProperty('AGENT_FORM_ID');
  if (agentFormId) {
    ScriptApp.newTrigger('onAgentFormSubmit').forForm(FormApp.openById(agentFormId)).onFormSubmit().create();
  } else {
    Logger.log('AGENT_FORM_ID script property not set - skipping the agent-signup form trigger. ' +
      'Set it (Project Settings > Script Properties) and re-run createTriggers() to turn on automatic onboarding.');
  }

  Logger.log('Triggers installed: ' + ScriptApp.getProjectTriggers().length);
}

/** Run once (after creating the "Summary" tab) to write its header row. Safe to re-run. */
function ensureSummarySheetHeader() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Summary');
  if (!sheet) {
    throw new Error('Create a sheet tab named "Summary" first, then re-run this function.');
  }
  sheet.getRange(1, 1, 1, 6).setValues([[
    'Week Ended', 'Agent Name', 'Agent Email', 'Weekly Total Points', 'Weekly Avg Points/Day', 'Rank',
  ]]);
}

/**
 * Non-destructive sanity check - run this any time you want to confirm the script is wired up
 * correctly, without sending any email or touching real submission data. Read the output in
 * the Execution Log panel (the same place errors showed up when testing other functions).
 * Safe to run as many times as you like: syncResponseColumns and recomputeAllDailyTotals are
 * both idempotent.
 */
function runSelfTest() {
  var tasks = getTasksList();
  var agents = getAgentsList();
  Logger.log('Tasks found (' + tasks.length + '): ' + JSON.stringify(tasks));
  Logger.log('Agents found (' + agents.length + '): ' + JSON.stringify(agents));

  syncResponseColumns();
  recomputeAllDailyTotals();

  var responseSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RESPONSE');
  var header = responseSheet.getRange(1, 1, 1, responseSheet.getLastColumn()).getValues()[0];
  Logger.log('RESPONSE header after sync (' + header.length + ' columns): ' + JSON.stringify(header));

  var uniqueHeaders = {};
  var duplicates = [];
  header.forEach(function (h) {
    var trimmed = String(h).trim();
    if (uniqueHeaders[trimmed]) duplicates.push(trimmed);
    uniqueHeaders[trimmed] = true;
  });
  if (duplicates.length > 0) {
    Logger.log('WARNING: duplicate column name(s) found, delete the extra one(s) by hand: ' + JSON.stringify(duplicates));
  }
  if (header.indexOf('Daily Totals') === -1 && uniqueHeaders['Daily Totals'] === undefined) {
    Logger.log('WARNING: no "Daily Totals" column found (checked trimmed names too) - Daily Total will never be computed.');
  }

  var summarySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Summary');
  Logger.log(summarySheet
    ? 'Summary sheet OK (' + summarySheet.getLastColumn() + ' header columns).'
    : 'WARNING: no "Summary" sheet tab found - create one and run ensureSummarySheetHeader().');

  var props = PropertiesService.getScriptProperties();
  Logger.log(props.getProperty('SHARED_SECRET')
    ? 'SHARED_SECRET script property is set.'
    : 'WARNING: SHARED_SECRET script property is not set yet.');
  Logger.log(props.getProperty('APP_TOKEN_SECRET')
    ? 'APP_TOKEN_SECRET script property is set.'
    : 'WARNING: APP_TOKEN_SECRET script property is not set yet - reminder emails cannot build entry links without it.');
  Logger.log(props.getProperty('APP_BASE_URL')
    ? 'APP_BASE_URL script property is set (' + props.getProperty('APP_BASE_URL') + ').'
    : 'WARNING: APP_BASE_URL script property is not set yet - reminder emails cannot build entry links without it.');

  if (props.getProperty('APP_TOKEN_SECRET') && props.getProperty('APP_BASE_URL') && agents.length > 0) {
    Logger.log('Sample entry link for ' + agents[0].email + ': ' + buildEntryLink_(agents[0].email) +
      ' - compare this against /admin for the same agent to confirm the token matches.');
  }

  var agentFormId = props.getProperty('AGENT_FORM_ID');
  Logger.log(agentFormId
    ? 'AGENT_FORM_ID is set (' + agentFormId + ') - automatic agent onboarding is active once createTriggers() has been (re-)run since setting it.'
    : 'AGENT_FORM_ID is not set - automatic agent onboarding from a signup form is off (this is fine if you are not using one).');

  Logger.log('Self-test complete - review any WARNING lines above.');
}

// ============================================================
// WebApi
// ============================================================

/**
 * Web App API - lets the Vercel frontend read/write this sheet WITHOUT a Google Cloud service
 * account. Deploy via Extensions > Apps Script > Deploy > New deployment > type "Web app",
 * with "Execute as: Me" and "Who has access: Anyone" (required since Vercel's server has no
 * Google identity to authenticate as). This is safe specifically because every request must
 * present SHARED_SECRET below - "Anyone" means anyone can reach the URL, not that anyone can
 * use it without the secret.
 *
 * One-time setup: Project Settings (gear icon) > Script Properties > Add script property,
 * key "SHARED_SECRET", value a long random string of your choosing. Put that same value in
 * the frontend's APPS_SCRIPT_SHARED_SECRET env var.
 */

function getSharedSecret_() {
  var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret) {
    throw new Error('Set a "SHARED_SECRET" script property first (Project Settings > Script Properties).');
  }
  return secret;
}

function checkSecret_(provided) {
  var expected = getSharedSecret_();
  return typeof provided === 'string' && provided.length === expected.length && provided === expected;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var provided = e && e.parameter ? e.parameter.secret : null;
  if (!checkSecret_(provided)) {
    return jsonOutput_({ error: 'unauthorized' });
  }
  try {
    return jsonOutput_(getAllData_());
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ error: 'bad_json' });
  }
  if (!checkSecret_(body.secret)) {
    return jsonOutput_({ error: 'unauthorized' });
  }
  try {
    if (body.action === 'writeRow') {
      writeResponseRow_(body.header, body.existingSheetRow, body.rowValues);
      return jsonOutput_({ ok: true });
    }
    return jsonOutput_({ error: 'unknown_action' });
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

// A real Date-typed cell would otherwise serialize to a UTC ISO timestamp via JSON.stringify
// (losing the spreadsheet's own timezone, e.g. a midnight-Dubai date could show as the
// previous day in UTC) - dates are formatted to plain "yyyy-MM-dd" text here, server-side,
// using the spreadsheet's own timezone, so the Next.js app never has to guess a format.
function normalizeRowForJson_(row, tz) {
  return row.map(function (cell) {
    return cell instanceof Date ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd') : cell;
  });
}

function getAllData_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var responseSheet = ss.getSheetByName('RESPONSE');
  var summarySheet = ss.getSheetByName('Summary');

  var lastRow = responseSheet.getLastRow();
  var lastCol = responseSheet.getLastColumn();
  var header = lastCol > 0 ? responseSheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var responseData = lastRow > 1
    ? responseSheet.getRange(2, 1, lastRow - 1, lastCol).getValues().map(function (r) {
        return normalizeRowForJson_(r, tz);
      })
    : [];

  var sLastRow = summarySheet ? summarySheet.getLastRow() : 0;
  var summaryData = summarySheet && sLastRow > 1
    ? summarySheet.getRange(2, 1, sLastRow - 1, 6).getValues().map(function (r) {
        return normalizeRowForJson_(r, tz);
      })
    : [];

  return {
    agents: getAgentsList(),
    tasks: getTasksList(),
    header: header,
    responseData: responseData,
    summaryData: summaryData,
  };
}

function writeResponseRow_(header, existingSheetRow, rowValues) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RESPONSE');
  if (existingSheetRow) {
    sheet.getRange(existingSheetRow, 1, 1, header.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
}

// ============================================================
// Links
// ============================================================

/**
 * Reproduces the frontend's private-link token exactly, so this script can email an agent a
 * working /entry/<token> link without ever asking the frontend for it. This ONLY works
 * because APP_TOKEN_SECRET is set to the exact same value in both places (Script Properties
 * here, the APP_TOKEN_SECRET env var in Vercel) - the frontend never needs to be called.
 *
 * One-time setup: Project Settings > Script Properties > add:
 *   APP_TOKEN_SECRET - same value as the frontend's APP_TOKEN_SECRET env var
 *   APP_BASE_URL     - the frontend's URL, e.g. https://your-app.vercel.app (no trailing slash)
 *
 * Algorithm must match lib/tokens.js's generateToken() exactly: base64url(HMAC_SHA256(secret,
 * normalizedEmail)), normalized = trim + lowercase. Verified by computing the same email's
 * token both ways and confirming they're byte-for-byte identical before this was relied on.
 */
function getAppTokenSecret_() {
  var secret = PropertiesService.getScriptProperties().getProperty('APP_TOKEN_SECRET');
  if (!secret) {
    throw new Error('Set an "APP_TOKEN_SECRET" script property (same value as the frontend env var) first.');
  }
  return secret;
}

function getAppBaseUrl_() {
  var url = PropertiesService.getScriptProperties().getProperty('APP_BASE_URL');
  if (!url) {
    throw new Error('Set an "APP_BASE_URL" script property (your frontend URL) first.');
  }
  return url.replace(/\/+$/, '');
}

function computeAgentToken_(email) {
  var normalized = String(email || '').trim().toLowerCase();
  var rawBytes = Utilities.computeHmacSha256Signature(normalized, getAppTokenSecret_());
  var base64 = Utilities.base64Encode(rawBytes);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildEntryLink_(email) {
  return getAppBaseUrl_() + '/entry/' + computeAgentToken_(email);
}

// ============================================================
// Sync
// ============================================================

// Columns in RESPONSE that are never treated as a task. Mirrors FIXED_RESPONSE_COLUMNS in
// lib/sheetSchema.js on the Next.js side. Must be "Daily Totals" (plural) to match this
// sheet's actual header text.
var FIXED_RESPONSE_COLUMNS = ['Agent Name', 'Agent Email', 'Date', 'Daily Totals'];

// Sheet header cells can carry stray whitespace from manual editing (this sheet's real header
// has e.g. "Agent Name " and "Text/Social Media/Email Communication        " with trailing
// spaces) - every header read used for name-based matching must go through this first, or
// exact-string comparisons like headers.indexOf('Agent Email') silently fail and cascade into
// "column already exists" checks missing real matches (which is how a duplicate
// "Text/Social Media/Email Communication" column ended up appended after Daily Totals).
function trimHeaders_(headers) {
  return headers.map(function (h) { return String(h).trim(); });
}

/**
 * Keeps RESPONSE's columns in sync with TASKS rows: any task in TASKS that doesn't yet have
 * a matching RESPONSE column gets one, inserted immediately before "Daily Total" so that
 * column stays last (matching what a human opening the sheet expects) and existing data/order
 * is preserved by insertColumnBefore.
 */
function syncResponseColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tasksSheet = ss.getSheetByName('TASKS');
  var responseSheet = ss.getSheetByName('RESPONSE');
  if (!tasksSheet || !responseSheet) return;

  var taskNames = getTasksList().map(function (t) { return t.task; });
  var lastCol = responseSheet.getLastColumn();
  var headers = lastCol > 0 ? trimHeaders_(responseSheet.getRange(1, 1, 1, lastCol).getValues()[0]) : [];

  if (headers.length === 0) {
    // Brand new RESPONSE sheet with no header row yet - seed it from scratch.
    var seeded = ['Agent Name', 'Agent Email', 'Date'].concat(taskNames, ['Daily Totals']);
    responseSheet.getRange(1, 1, 1, seeded.length).setValues([seeded]);
    return;
  }

  var existing = {};
  headers.forEach(function (h) { existing[h] = true; });

  var dailyTotalIdx = headers.indexOf('Daily Totals') + 1; // 1-based column number
  if (dailyTotalIdx === 0) dailyTotalIdx = headers.length + 1;

  var missing = taskNames.filter(function (name) {
    return !existing[name] && FIXED_RESPONSE_COLUMNS.indexOf(name) === -1;
  });

  missing.forEach(function (name) {
    responseSheet.insertColumnBefore(dailyTotalIdx);
    responseSheet.getRange(1, dailyTotalIdx).setValue(name);
    dailyTotalIdx += 1;
  });

  if (missing.length > 0) {
    recomputeAllDailyTotals();
  }
}

/** TASKS!A2:C -> [{task, point, inputType}]. point is null when blank - the "no points
 * defined -> count it as 1" rule itself lives in Totals.gs, not here. */
function getTasksList() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TASKS');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  return rows
    .filter(function (r) { return r[0] !== '' && r[0] !== null; })
    .map(function (r) {
      var hasPoint = r[1] !== '' && r[1] !== null && !isNaN(r[1]);
      return {
        task: String(r[0]).trim(),
        point: hasPoint ? Number(r[1]) : null,
        inputType: r[2] ? String(r[2]).trim() : 'Number',
      };
    });
}

/** AGENTS!A2:C -> [{email, name, profilePictureLink}] */
function getAgentsList() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AGENTS');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  return rows
    .filter(function (r) { return r[0] !== '' && r[0] !== null; })
    .map(function (r) {
      return {
        email: String(r[0]).trim(),
        name: r[1] ? String(r[1]).trim() : '',
        profilePictureLink: r[2] ? String(r[2]).trim() : '',
      };
    });
}

// ============================================================
// Agent Signup Form
// ============================================================

/**
 * Automatically adds/updates an AGENTS row whenever someone submits the agent-signup Google
 * Form (matched by question title, so this survives reordering questions - it just needs a
 * "Name", "Email", and "Upload Profile Photo" question to exist somewhere in the form).
 *
 * One-time setup: Project Settings > Script Properties > add "AGENT_FORM_ID" - the form's ID
 * from its edit URL, e.g. docs.google.com/forms/d/<THIS_PART>/edit. Then re-run
 * createTriggers() - it only wires this up if AGENT_FORM_ID is present, and does nothing if
 * you're not using a signup form at all.
 *
 * This is the same "no caching" trick the rest of the app relies on: the Next.js frontend
 * already re-reads AGENTS fresh on every request, so a newly-added agent gets a working
 * /entry/<token> link with zero frontend changes - this trigger is the only new moving part.
 */
function onAgentFormSubmit(e) {
  var itemResponses = e.response.getItemResponses();
  var name = findAnswerByTitle_(itemResponses, 'Name');
  var email = findAnswerByTitle_(itemResponses, 'Email');
  var fileIds = findAnswerByTitle_(itemResponses, 'Upload Profile Photo');

  if (!email) {
    Logger.log('Agent signup form submitted with no answer to "Email" - skipping.');
    return;
  }

  var profilePictureLink = (fileIds && fileIds.length > 0) ? makeDriveImagePublicLink_(fileIds[0]) : '';
  upsertAgent_(email, name || '', profilePictureLink);
}

function findAnswerByTitle_(itemResponses, title) {
  for (var i = 0; i < itemResponses.length; i++) {
    if (itemResponses[i].getItem().getTitle().trim() === title) {
      return itemResponses[i].getResponse();
    }
  }
  return null;
}

/**
 * A Drive file-upload answer is a file ID, not a usable image URL - a plain Drive share link
 * (.../file/d/<id>/view) opens an HTML viewer, not a raw image, so it won't render in an
 * &lt;img&gt; tag. This makes the file link-viewable and builds a direct-embeddable URL instead.
 *
 * Uses the lh3.googleusercontent.com image-CDN form rather than drive.google.com/uc?export=view
 * - the latter redirects through a "download" endpoint that can intermittently show a virus-scan
 * or "too many requests" interstitial in real browsers instead of the image, even though it often
 * succeeds from a plain HTTP client. lh3 is a single direct response, no redirect.
 */
function makeDriveImagePublicLink_(fileId) {
  try {
    DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    Logger.log('Could not set sharing on uploaded profile photo ' + fileId + ': ' + err);
  }
  return 'https://lh3.googleusercontent.com/d/' + fileId;
}

/**
 * One-time fix for agents whose photo link was already saved in the old, less reliable format
 * before this change. Safe to re-run - it only rewrites cells that still match the old pattern.
 */
function fixExistingProfilePhotoLinks() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AGENTS');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var range = sheet.getRange(2, 3, lastRow - 1, 1); // column C: Profile Picture Link
  var values = range.getValues();
  var fixed = 0;

  var updated = values.map(function (row) {
    var link = row[0];
    var match = typeof link === 'string' && link.match(/drive\.google\.com\/uc\?export=view&id=([^&]+)/);
    if (!match) return row;
    fixed += 1;
    return ['https://lh3.googleusercontent.com/d/' + match[1]];
  });

  if (fixed > 0) range.setValues(updated);
  Logger.log('Fixed ' + fixed + ' old-format profile photo link(s).');
}

/** Adds a new AGENTS row, or updates name/photo for an existing one matched by email
 * (case/whitespace insensitive) - so resubmitting the form (e.g. to fix a typo) doesn't create
 * a duplicate. A resubmission with no new photo keeps the agent's existing photo rather than
 * blanking it out, since "Upload Profile Photo" isn't a required question. */
function upsertAgent_(email, name, profilePictureLink) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AGENTS');
  var lastRow = sheet.getLastRow();
  var targetEmail = String(email).trim().toLowerCase();

  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim().toLowerCase() === targetEmail) {
        var existingLink = rows[i][2] ? String(rows[i][2]).trim() : '';
        sheet.getRange(i + 2, 2, 1, 2).setValues([[name, profilePictureLink || existingLink]]);
        Logger.log('Updated existing agent from form submission: ' + email);
        return;
      }
    }
  }

  sheet.appendRow([email, name, profilePictureLink]);
  Logger.log('Added new agent from form submission: ' + email);
}

// ============================================================
// Totals
// ============================================================

/**
 * Daily Total = sum(enteredValue * (matching TASKS.POINT, or *1 if that task has no POINT
 * row)). This is the deliberately-duplicated twin of computeDailyTotal in lib/points.js on
 * the Next.js side - Node and Apps Script can't share a module, so if this rule ever changes,
 * change it in both places.
 */
function recomputeAllDailyTotals() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('RESPONSE');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return;

  var headers = trimHeaders_(sheet.getRange(1, 1, 1, lastCol).getValues()[0]);
  var dailyTotalIdx = headers.indexOf('Daily Totals');
  if (dailyTotalIdx === -1) return;

  var pointByTask = {};
  getTasksList().forEach(function (t) { pointByTask[t.task] = t.point; });

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var totals = data.map(function (row) {
    var total = 0;
    headers.forEach(function (h, idx) {
      if (FIXED_RESPONSE_COLUMNS.indexOf(h) !== -1) return;
      var raw = row[idx];
      var numeric = typeof raw === 'boolean' ? (raw ? 1 : 0) : (parseFloat(raw) || 0);
      var hasPoint = Object.prototype.hasOwnProperty.call(pointByTask, h) && pointByTask[h] !== null;
      var point = hasPoint ? pointByTask[h] : 1;
      total += numeric * point;
    });
    return [total];
  });

  sheet.getRange(2, dailyTotalIdx + 1, totals.length, 1).setValues(totals);
  dedupeResponseRows_(headers, sheet);
}

/**
 * Self-healing safety net for the rare double-submit race (e.g. a double-click or a retried
 * request racing the "does a row already exist for this agent+date" check in /api/submit):
 * if two RESPONSE rows exist for the same (email, date), keep the later sheet row (the more
 * recent write) and delete the earlier one.
 */
function dedupeResponseRows_(headers, sheet) {
  var emailIdx = headers.indexOf('Agent Email');
  var dateIdx = headers.indexOf('Date');
  if (emailIdx === -1 || dateIdx === -1) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var seen = {};
  var rowsToDelete = [];
  data.forEach(function (row, i) {
    var key = String(row[emailIdx]).trim().toLowerCase() + '|' + formatDateCell_(row[dateIdx]);
    if (Object.prototype.hasOwnProperty.call(seen, key)) {
      rowsToDelete.push(seen[key]); // earlier occurrence's sheet row -> delete it
    }
    seen[key] = i + 2; // 1-indexed sheet row, +1 to skip the header
  });

  rowsToDelete.sort(function (a, b) { return b - a; }); // delete bottom-up so indices stay valid
  rowsToDelete.forEach(function (r) { sheet.deleteRow(r); });
}

/** Real Date-typed cells -> "yyyy-MM-dd" in the spreadsheet's own timezone; text cells pass
 * through as-is (this app always writes plain "yyyy-MM-dd" text going forward - see
 * writeResponseRow in lib/sheets.js). */
function formatDateCell_(cell) {
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return String(cell).trim();
}

// ============================================================
// WeeklySummary
// ============================================================

/**
 * Runs Monday mornings (see Setup.gs): rolls the just-finished Mon-Sun week's RESPONSE data
 * into the Summary sheet (one row per agent, newest week inserted at the top), then emails
 * the Top 3. Idempotent - if a block for that week's end date already exists, it's skipped,
 * so re-running (or a rare duplicate trigger fire) never double-counts or double-emails.
 */
function weeklyRollup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var bounds = getPreviousIsoWeekBounds_(new Date(), tz);

  if (weekAlreadySummarized_(bounds.weekEnd)) return;

  var totals = sumResponseByAgentInRange_(bounds.weekStart, bounds.weekEnd);
  var agents = getAgentsList();
  agents.forEach(function (a) {
    var key = a.email.toLowerCase();
    if (!totals[key]) {
      totals[key] = { name: a.name, email: a.email, total: 0 };
    }
  });

  var ranked = Object.keys(totals)
    .map(function (key) { return totals[key]; })
    .map(function (t) { return { name: t.name, email: t.email, total: t.total, avgPerDay: t.total / 7 }; })
    .sort(function (a, b) { return b.total - a.total; })
    .map(function (t, i) { return Object.assign({}, t, { rank: i + 1 }); });

  writeSummaryBlock_(bounds.weekEnd, ranked);

  var top3 = ranked.filter(function (t) { return t.total > 0; }).slice(0, 3);
  var prevBounds = weekBoundsBefore_(bounds.weekStart, tz);

  // Every agent gets their own email: the same team-wide Top 3 leaderboard, plus their own
  // per-task breakdown and week-over-week comparison - not just a broadcast to whoever won.
  agents.forEach(function (agent) {
    var thisWeek = buildMonthlyStats_(agent.email, bounds.weekStart, bounds.weekEnd);
    var lastWeek = buildMonthlyStats_(agent.email, prevBounds.weekStart, prevBounds.weekEnd);
    sendWeeklyPersonalEmail_(agent, bounds.weekEnd, top3, thisWeek, lastWeek, false);
  });
}

/** The Monday-Sunday week that ended most recently before `now`. */
function getPreviousIsoWeekBounds_(now, tz) {
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var today = new Date(todayStr + 'T00:00:00');
  var isoDay = today.getDay() === 0 ? 7 : today.getDay(); // 1=Mon .. 7=Sun
  var thisMonday = new Date(today.getTime());
  thisMonday.setDate(today.getDate() - (isoDay - 1));
  var prevMonday = new Date(thisMonday.getTime());
  prevMonday.setDate(thisMonday.getDate() - 7);
  var prevSunday = new Date(thisMonday.getTime());
  prevSunday.setDate(thisMonday.getDate() - 1);
  return {
    weekStart: Utilities.formatDate(prevMonday, tz, 'yyyy-MM-dd'),
    weekEnd: Utilities.formatDate(prevSunday, tz, 'yyyy-MM-dd'),
  };
}

/** The Monday-Sunday week immediately before the week that starts on `weekStartStr`. */
function weekBoundsBefore_(weekStartStr, tz) {
  var d = new Date(weekStartStr + 'T00:00:00');
  var prevSunday = new Date(d.getTime());
  prevSunday.setDate(d.getDate() - 1);
  var prevMonday = new Date(prevSunday.getTime());
  prevMonday.setDate(prevSunday.getDate() - 6);
  return {
    weekStart: Utilities.formatDate(prevMonday, tz, 'yyyy-MM-dd'),
    weekEnd: Utilities.formatDate(prevSunday, tz, 'yyyy-MM-dd'),
  };
}

function weekAlreadySummarized_(weekEndStr) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Summary');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  return values.some(function (row) { return formatDateCell_(row[0]) === weekEndStr; });
}

function sumResponseByAgentInRange_(startStr, endStr) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RESPONSE');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var totals = {};
  if (lastRow < 2) return totals;

  var headers = trimHeaders_(sheet.getRange(1, 1, 1, lastCol).getValues()[0]);
  var emailIdx = headers.indexOf('Agent Email');
  var nameIdx = headers.indexOf('Agent Name');
  var dateIdx = headers.indexOf('Date');
  var totalIdx = headers.indexOf('Daily Totals');
  if (emailIdx === -1 || dateIdx === -1 || totalIdx === -1) return totals;

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  data.forEach(function (row) {
    var dateStr = formatDateCell_(row[dateIdx]);
    if (dateStr < startStr || dateStr > endStr) return;
    var email = String(row[emailIdx]).trim();
    var key = email.toLowerCase();
    if (!totals[key]) {
      totals[key] = { name: row[nameIdx] ? String(row[nameIdx]).trim() : '', email: email, total: 0 };
    }
    totals[key].total += Number(row[totalIdx]) || 0;
  });
  return totals;
}

function writeSummaryBlock_(weekEndStr, ranked) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Summary');
  var rows = ranked.map(function (a) {
    return [weekEndStr, a.name, a.email, a.total, Math.round(a.avgPerDay * 10) / 10, a.rank];
  });
  if (rows.length === 0) return;
  sheet.insertRowsBefore(2, rows.length);
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
}

// ============================================================
// Email
// ============================================================

var MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

var MOTIVATIONAL_QUOTES = [
  'Success is the sum of small efforts repeated day in and day out.',
  'The only way to do great work is to keep showing up.',
  'Consistency beats intensity — one more call, one more post, one more win.',
  'Every contact is a chance. Every follow-up is progress.',
  'Small daily improvements lead to stunning long-term results.',
  'Discipline is choosing between what you want now and what you want most.',
  'Great things happen to those who don’t stop believing, trying, learning.',
  'Your future is created by what you do today, not tomorrow.',
  'Progress, not perfection — keep logging, keep growing.',
  'The comeback is always stronger than the setback.',
  'Well done is better than well said — keep taking action.',
  'A little progress each day adds up to big results.',
];

function pickQuote_() {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
}

function renderQuoteHtml_() {
  return '<div style="margin-top:20px;padding:14px 16px;background:#eef2ff;border-left:4px solid #4f46e5;border-radius:6px;">' +
    '<p style="margin:0;font-style:italic;color:#3730a3;font-size:13px;">“' + escapeHtml_(pickQuote_()) + '”</p>' +
    '</div>';
}

/**
 * Shared visual shell for every email this script sends (daily/weekly/monthly/test) - a
 * centered card with a colored header, so all emails look like they come from one system
 * instead of each being an ad hoc unstyled table. Inline styles only: most email clients
 * (Gmail included) strip <style> blocks, so every rule has to live on the element itself.
 */
function emailShell_(title, innerHtml, isTest) {
  var banner = isTest
    ? '<div style="background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;padding:8px 12px;' +
      'border-radius:6px;font-size:12px;font-weight:bold;margin-bottom:16px;">' +
      'TEST EMAIL — fabricated numbers, not real data</div>'
    : '';
  return '' +
    '<div style="background:#f4f5f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">' +
        '<div style="background-color:#4f46e5;background-image:linear-gradient(135deg,#4f46e5,#7c3aed);padding:20px 24px;">' +
          '<p style="margin:0;color:#e0e7ff;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">MDM Accountability Tracker</p>' +
          '<h1 style="margin:4px 0 0;color:#ffffff;font-size:20px;">' + escapeHtml_(title) + '</h1>' +
        '</div>' +
        '<div style="padding:24px;color:#111827;font-size:14px;line-height:1.5;">' +
          banner + innerHtml +
        '</div>' +
        '<div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">' +
          '<p style="margin:0;color:#9ca3af;font-size:11px;">Automated message from your MDM Accountability Tracker.</p>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function renderTop3SectionHtml_(top3, periodLabel) {
  var label = periodLabel || 'this week';
  if (!top3 || top3.length === 0) {
    return '' +
      '<h2 style="font-size:15px;margin:0 0 10px;color:#111827;">\u{1F3C6} Top performers ' + escapeHtml_(label) + '</h2>' +
      '<p style="color:#6b7280;font-size:13px;">No activity logged by anyone yet ' + escapeHtml_(label) + '.</p>';
  }
  var medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  var rows = top3.map(function (a, i) {
    return '' +
      '<tr>' +
        '<td style="padding:10px 8px;font-size:20px;width:32px;">' + (medals[i] || '') + '</td>' +
        '<td style="padding:10px 8px;font-weight:600;color:#111827;">' + escapeHtml_(a.name) + '</td>' +
        '<td style="padding:10px 8px;text-align:right;color:#4f46e5;font-weight:700;">' + a.total + ' pts</td>' +
      '</tr>';
  }).join('');
  return '' +
    '<h2 style="font-size:15px;margin:0 0 10px;color:#111827;">\u{1F3C6} Top performers ' + escapeHtml_(label) + '</h2>' +
    '<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;">' + rows + '</table>';
}

/** Renders a simple two-column task -> amount table, used by both the weekly-personal and
 * daily sections (and could be reused by the monthly one - kept separate there since it
 * shares markup with the conversion breakdown). */
function renderTaskBreakdownTableHtml_(perTask) {
  var keys = Object.keys(perTask);
  if (keys.length === 0) {
    return '<p style="color:#6b7280;font-size:13px;">No activity logged.</p>';
  }
  var rows = keys.map(function (k) {
    return '' +
      '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">' + escapeHtml_(k) + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;">' + perTask[k] + '</td>' +
      '</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;font-size:13px;">' + rows + '</table>';
}

/** "+X% vs <referenceLabel> (Y pts)" in green/red, or a neutral fallback when there's no
 * history yet to compare against. Shared by the daily/weekly/monthly emails. */
function renderComparisonHtml_(currentTotal, referenceTotal, referenceLabel) {
  if (!referenceTotal || referenceTotal <= 0) {
    return '<p style="color:#6b7280;font-size:13px;margin:6px 0 0;">Not enough history yet to compare.</p>';
  }
  var deltaPct = Math.round(((currentTotal - referenceTotal) / referenceTotal) * 100);
  var up = deltaPct >= 0;
  var color = up ? '#059669' : '#dc2626';
  var arrow = up ? '↑' : '↓';
  return '<p style="font-size:13px;color:' + color + ';font-weight:600;margin:6px 0 0;">' +
    arrow + ' ' + Math.abs(deltaPct) + '% vs ' + referenceLabel + ' (' + (Math.round(referenceTotal * 10) / 10) + ' pts)</p>';
}

function sendWeeklyPersonalEmail_(agent, weekEndStr, top3, thisWeek, lastWeek, isTest) {
  var body = '' +
    renderTop3SectionHtml_(top3) +
    '<h2 style="font-size:15px;margin:20px 0 10px;color:#111827;">\u{1F4CB} Your week</h2>' +
    renderTaskBreakdownTableHtml_(thisWeek.perTask) +
    '<p style="margin:10px 0 0;font-weight:700;">Total: ' + thisWeek.grandTotal + ' pts</p>' +
    renderComparisonHtml_(thisWeek.grandTotal, lastWeek.grandTotal, 'last week') +
    renderQuoteHtml_();

  MailApp.sendEmail({
    to: agent.email,
    subject: (isTest ? '[TEST] ' : '') + 'Your week in review — ' + weekEndStr,
    htmlBody: emailShell_('Week ended ' + weekEndStr, body, !!isTest),
  });
}

/**
 * Sends a real email, right now, to every current agent, using fabricated sample numbers
 * instead of real weekly totals - for testing that email delivery/formatting works without
 * waiting for a real Mon-Sun week to finish or needing real RESPONSE data to exist yet.
 * Clearly marked as a test in both the subject and the body. Safe to run repeatedly.
 */
function sendTestWeeklyEmail() {
  var agents = getAgentsList();
  if (agents.length === 0) {
    Logger.log('No agents found - add rows to AGENTS first.');
    return;
  }
  var fakeTop3 = agents.slice(0, 3).map(function (a, i) {
    return { name: a.name, total: (3 - i) * 10 };
  });
  var fakeThisWeek = {
    perTask: { 'Phone Conversation': 5, 'Facebook Post About Business': 2, 'Personal AOA': 1 },
    grandTotal: 5 * 2 + 2 * 3 + 1 * 10,
  };
  var fakeLastWeek = { perTask: {}, grandTotal: 12 };
  agents.forEach(function (agent) {
    sendWeeklyPersonalEmail_(agent, 'TEST', fakeTop3, fakeThisWeek, fakeLastWeek, true);
  });
  Logger.log('Test weekly email sent to: ' + agents.map(function (a) { return a.email; }).join(', '));
}

/**
 * Runs on the 1st of each month: emails every agent their individual summary for the month
 * just finished - per-task totals, a comparison to last month's total, and "doing well" /
 * "could improve" callouts against their own trailing 3-month average per task.
 */
function monthlyRollup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var y = Number(Utilities.formatDate(now, tz, 'yyyy'));
  var m = Number(Utilities.formatDate(now, tz, 'MM'));

  var period = calendarMonthRange_.apply(null, monthBeforeAsArgs_(y, m));
  var prevPeriod = calendarMonthRange_.apply(null, monthBeforeAsArgs_(period.year, period.month));

  var agents = getAgentsList();
  var tasks = getTasksList();
  var conversionTasks = tasks.filter(function (t) {
    return /contact|appointment|conversion/i.test(t.task);
  });

  // Compute every agent's stats for the period once - reused both for their own email and to
  // build the team-wide monthly leaderboard shared across all of them, so nobody's data is
  // read from RESPONSE twice.
  var statsByEmail = {};
  agents.forEach(function (agent) {
    statsByEmail[agent.email] = buildMonthlyStats_(agent.email, period.start, period.end);
  });

  var monthlyTop3 = agents
    .map(function (a) { return { name: a.name, total: statsByEmail[a.email].grandTotal }; })
    .filter(function (t) { return t.total > 0; })
    .sort(function (a, b) { return b.total - a.total; })
    .slice(0, 3);

  agents.forEach(function (agent) {
    var stats = statsByEmail[agent.email];
    var prevStats = buildMonthlyStats_(agent.email, prevPeriod.start, prevPeriod.end);
    var baseline = buildTrailingAverage_(agent.email, period.year, period.month, 3);
    var callouts = baseline.monthsCounted > 0 ? buildCallouts_(stats.perTask, baseline.perTaskAvg) : null;
    var conversionSection = conversionTasks.length > 0
      ? buildConversionSection_(stats.perTask, conversionTasks)
      : null;

    MailApp.sendEmail({
      to: agent.email,
      subject: 'Your ' + period.label + ' activity summary',
      htmlBody: renderMonthlyEmailHtml_(agent, stats, prevStats, callouts, conversionSection, period.label, false, monthlyTop3),
    });
  });
}

function monthBeforeAsArgs_(year, month) {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

function calendarMonthRange_(year, month) {
  var start = year + '-' + pad2_(month) + '-01';
  var lastDay = new Date(year, month, 0).getDate();
  var end = year + '-' + pad2_(month) + '-' + pad2_(lastDay);
  return { year: year, month: month, start: start, end: end, label: MONTH_NAMES[month - 1] + ' ' + year };
}

function pad2_(n) { return n < 10 ? '0' + n : String(n); }

function buildMonthlyStats_(email, startStr, endStr) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RESPONSE');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var perTask = {};
  var grandTotal = 0;
  if (lastRow < 2) return { perTask: perTask, grandTotal: grandTotal };

  var headers = trimHeaders_(sheet.getRange(1, 1, 1, lastCol).getValues()[0]);
  var emailIdx = headers.indexOf('Agent Email');
  var dateIdx = headers.indexOf('Date');
  var totalIdx = headers.indexOf('Daily Totals');
  if (emailIdx === -1 || dateIdx === -1 || totalIdx === -1) return { perTask: perTask, grandTotal: grandTotal };
  var targetEmail = email.trim().toLowerCase();

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  data.forEach(function (row) {
    if (String(row[emailIdx]).trim().toLowerCase() !== targetEmail) return;
    var dateStr = formatDateCell_(row[dateIdx]);
    if (dateStr < startStr || dateStr > endStr) return;
    headers.forEach(function (h, idx) {
      if (FIXED_RESPONSE_COLUMNS.indexOf(h) !== -1) return;
      var raw = row[idx];
      var numeric = typeof raw === 'boolean' ? (raw ? 1 : 0) : (parseFloat(raw) || 0);
      perTask[h] = (perTask[h] || 0) + numeric;
    });
    grandTotal += Number(row[totalIdx]) || 0;
  });

  return { perTask: perTask, grandTotal: grandTotal };
}

/** Average per-task totals over up to `monthsBack` prior months, skipping any month with no
 * RESPONSE rows at all (agent not tracked yet) so an early "first month" doesn't get diluted
 * by phantom zeros. */
function buildTrailingAverage_(email, year, month, monthsBack) {
  var sums = {};
  var counted = 0;
  var cursor = [year, month];

  for (var i = 0; i < monthsBack; i++) {
    cursor = monthBeforeAsArgs_(cursor[0], cursor[1]);
    var range = calendarMonthRange_(cursor[0], cursor[1]);
    var stats = buildMonthlyStats_(email, range.start, range.end);
    if (Object.keys(stats.perTask).length === 0) continue;
    counted += 1;
    Object.keys(stats.perTask).forEach(function (task) {
      sums[task] = (sums[task] || 0) + stats.perTask[task];
    });
  }

  var perTaskAvg = {};
  Object.keys(sums).forEach(function (task) { perTaskAvg[task] = sums[task] / counted; });
  return { perTaskAvg: perTaskAvg, monthsCounted: counted };
}

var DEFAULT_IMPROVEMENT_TIP = 'Try setting a small daily target for this task so it becomes routine.';

function buildCallouts_(perTask, perTaskAvg) {
  var doingWell = [];
  var couldImprove = [];
  Object.keys(perTaskAvg).forEach(function (task) {
    var avg = perTaskAvg[task];
    if (avg <= 0) return;
    var actual = perTask[task] || 0;
    var ratio = actual / avg;
    if (ratio >= 1.1) {
      doingWell.push({ task: task, actual: actual, avg: avg });
    } else if (ratio <= 0.9) {
      couldImprove.push({ task: task, actual: actual, avg: avg, tip: DEFAULT_IMPROVEMENT_TIP });
    }
  });
  return { doingWell: doingWell, couldImprove: couldImprove };
}

/** Generic breakdown of every task whose name matches contact/appointment/conversion, plus a
 * specific conversion % when a "contact"-like and a "conversion"-like task both exist. */
function buildConversionSection_(perTask, conversionTasks) {
  var breakdown = {};
  conversionTasks.forEach(function (t) { breakdown[t.task] = perTask[t.task] || 0; });

  var contactsTask = conversionTasks.filter(function (t) { return /contact/i.test(t.task); })[0];
  var conversionTask = conversionTasks.filter(function (t) { return /conversion/i.test(t.task); })[0];
  var contacts = contactsTask ? breakdown[contactsTask.task] : null;
  var conversions = conversionTask ? breakdown[conversionTask.task] : null;
  var rate = (contacts && conversions !== null && contacts > 0) ? (conversions / contacts) * 100 : null;

  return { breakdown: breakdown, conversionRatePct: rate };
}

function renderMonthlyEmailHtml_(agent, stats, prevStats, callouts, conversionSection, label, isTest, monthlyTop3) {
  var parts = [];
  if (monthlyTop3) {
    parts.push(renderTop3SectionHtml_(monthlyTop3, 'this month'));
    parts.push('<div style="height:20px;"></div>');
  }
  parts.push('<p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Hi ' + escapeHtml_(agent.name) + ',</p>');
  parts.push('<p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;">' +
    stats.grandTotal + ' pts <span style="font-size:13px;font-weight:400;color:#6b7280;">total this month</span></p>');
  parts.push(renderComparisonHtml_(stats.grandTotal, prevStats.grandTotal, 'last month'));

  parts.push('<h2 style="font-size:15px;margin:20px 0 10px;color:#111827;">\u{1F4CB} Breakdown by task</h2>');
  parts.push(renderTaskBreakdownTableHtml_(stats.perTask));

  if (conversionSection) {
    parts.push('<h2 style="font-size:15px;margin:20px 0 10px;color:#111827;">\u{1F4DE} Contacts, appointments &amp; conversions</h2>');
    parts.push(renderTaskBreakdownTableHtml_(conversionSection.breakdown));
    if (conversionSection.conversionRatePct !== null) {
      parts.push('<p style="margin:8px 0 0;font-weight:700;color:#4f46e5;">Conversion rate: ' +
        conversionSection.conversionRatePct.toFixed(1) + '%</p>');
    }
  }

  if (callouts) {
    if (callouts.doingWell.length > 0) {
      parts.push('<h2 style="font-size:15px;margin:20px 0 10px;color:#059669;">✅ Doing well</h2><ul style="margin:0;padding-left:18px;font-size:13px;">');
      callouts.doingWell.forEach(function (c) {
        parts.push('<li style="margin-bottom:4px;">' + escapeHtml_(c.task) + ': <strong>' + c.actual +
          '</strong> vs your recent average of ' + (Math.round(c.avg * 10) / 10) + '</li>');
      });
      parts.push('</ul>');
    }
    if (callouts.couldImprove.length > 0) {
      parts.push('<h2 style="font-size:15px;margin:20px 0 10px;color:#d97706;">\u{1F4C8} Room to grow</h2><ul style="margin:0;padding-left:18px;font-size:13px;">');
      callouts.couldImprove.forEach(function (c) {
        parts.push('<li style="margin-bottom:4px;">' + escapeHtml_(c.task) + ': ' + c.actual +
          ' vs your recent average of ' + (Math.round(c.avg * 10) / 10) + '. ' + escapeHtml_(c.tip) + '</li>');
      });
      parts.push('</ul>');
    }
  } else {
    parts.push('<p style="color:#6b7280;font-size:13px;margin-top:16px;">Keep logging your activity — once a full ' +
      'prior month is on file, this email will compare your progress task by task.</p>');
  }

  parts.push(renderQuoteHtml_());

  return emailShell_(label + ' summary', parts.join(''), !!isTest);
}

/**
 * Sends a real monthly-summary email, right now, to every current agent, using fabricated
 * sample numbers instead of real RESPONSE data - for testing delivery/formatting without
 * waiting for a full prior month to exist. Clearly marked as a test. Safe to run repeatedly.
 */
function sendTestMonthlyEmail() {
  var agents = getAgentsList();
  if (agents.length === 0) {
    Logger.log('No agents found - add rows to AGENTS first.');
    return;
  }
  var fakeStats = {
    perTask: { 'Phone Conversation': 12, 'Facebook Post About Business': 3, 'Personal AOA': 2 },
    grandTotal: 12 * 2 + 3 * 3 + 2 * 10,
  };
  var fakePrevStats = { perTask: {}, grandTotal: 30 };
  var fakeCallouts = {
    doingWell: [{ task: 'Phone Conversation', actual: 12, avg: 6 }],
    couldImprove: [{ task: 'Facebook Post About Business', actual: 3, avg: 8, tip: 'This is a sample tip for testing.' }],
  };

  var fakeMonthlyTop3 = agents.slice(0, 3).map(function (a, i) {
    return { name: a.name, total: (3 - i) * 15 };
  });

  agents.forEach(function (agent) {
    var html = renderMonthlyEmailHtml_(agent, fakeStats, fakePrevStats, fakeCallouts, null, 'TEST MONTH', true, fakeMonthlyTop3);
    MailApp.sendEmail({ to: agent.email, subject: '[TEST] Your monthly activity summary', htmlBody: html });
  });
  Logger.log('Test monthly email sent to: ' + agents.map(function (a) { return a.email; }).join(', '));
}

// ============================================================
// Daily
// ============================================================

/** Average Daily Total over the `days` days immediately before `beforeDateStr` (not counting
 * that date itself). Missed days count as 0, same "penalize gaps" philosophy as the weekly
 * average, so it's a fair same-scale comparison for "how did today stack up". */
function buildDailyTrailingAverage_(email, beforeDateStr, days) {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var before = new Date(beforeDateStr + 'T00:00:00');
  var start = new Date(before.getTime());
  start.setDate(start.getDate() - days);
  var end = new Date(before.getTime());
  end.setDate(end.getDate() - 1);
  var startStr = Utilities.formatDate(start, tz, 'yyyy-MM-dd');
  var endStr = Utilities.formatDate(end, tz, 'yyyy-MM-dd');
  return buildMonthlyStats_(email, startStr, endStr).grandTotal / days;
}

function renderDailySectionHtml_(agent, today, avgDaily) {
  return '' +
    '<p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Hi ' + escapeHtml_(agent.name) + ',</p>' +
    '<p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;">' +
      today.grandTotal + ' pts <span style="font-size:13px;font-weight:400;color:#6b7280;">today</span></p>' +
    renderComparisonHtml_(today.grandTotal, avgDaily, 'your recent daily average') +
    '<div style="margin-top:14px;">' + renderTaskBreakdownTableHtml_(today.perTask) + '</div>' +
    renderQuoteHtml_();
}

function sendDailySummaryEmail_(agent, dateStr, today, avgDaily, isTest) {
  MailApp.sendEmail({
    to: agent.email,
    subject: (isTest ? '[TEST] ' : '') + 'Nice work today, ' + agent.name + '!',
    htmlBody: emailShell_('Today’s activity — ' + dateStr, renderDailySectionHtml_(agent, today, avgDaily), !!isTest),
  });
}

/**
 * Runs daily in the evening (see createTriggers): emails each agent who logged at least one
 * task today their breakdown plus how it compares to their own trailing 7-day daily average.
 * Agents who logged nothing today are skipped entirely - this is positive reinforcement for
 * showing up, not a nag reminder for those who didn't.
 */
function sendDailySummaryEmails() {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  getAgentsList().forEach(function (agent) {
    var today = buildMonthlyStats_(agent.email, todayStr, todayStr);
    if (Object.keys(today.perTask).length === 0) return;
    var avgDaily = buildDailyTrailingAverage_(agent.email, todayStr, 7);
    sendDailySummaryEmail_(agent, todayStr, today, avgDaily, false);
  });
}

/**
 * Sends a real daily-summary email, right now, to every current agent, using fabricated
 * sample numbers - for testing delivery/formatting without waiting for a real submission
 * today. Clearly marked as a test. Safe to run repeatedly.
 */
function sendTestDailyEmail() {
  var agents = getAgentsList();
  if (agents.length === 0) {
    Logger.log('No agents found - add rows to AGENTS first.');
    return;
  }
  var fakeToday = {
    perTask: { 'Phone Conversation': 3, 'Text/Social Media/Email Communication': 5 },
    grandTotal: 3 * 2 + 5 * 1,
  };
  agents.forEach(function (agent) {
    sendDailySummaryEmail_(agent, 'TEST', fakeToday, 6, true);
  });
  Logger.log('Test daily email sent to: ' + agents.map(function (a) { return a.email; }).join(', '));
}

function renderReminderBodyHtml_(agent, link) {
  return '' +
    '<p style="margin:0 0 16px;color:#111827;font-size:14px;">Hi ' + escapeHtml_(agent.name) +
      ', don’t forget to log today’s activity.</p>' +
    '<div style="text-align:center;margin:24px 0;">' +
      '<a href="' + link + '" style="display:inline-block;background-color:#4f46e5;' +
      'background-image:linear-gradient(135deg,#4f46e5,#7c3aed);color:#ffffff;text-decoration:none;' +
      'padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Log today’s activity</a>' +
    '</div>' +
    '<p style="color:#6b7280;font-size:12px;word-break:break-all;">Or paste this link in your browser: ' +
      '<a href="' + link + '" style="color:#4f46e5;">' + link + '</a></p>' +
    renderQuoteHtml_();
}

function sendDailyEntryReminderEmail_(agent, isTest) {
  var link = buildEntryLink_(agent.email);
  MailApp.sendEmail({
    to: agent.email,
    subject: (isTest ? '[TEST] ' : '') + 'Log today’s activity, ' + agent.name,
    htmlBody: emailShell_('Time to log today’s activity', renderReminderBodyHtml_(agent, link), !!isTest),
  });
}

/**
 * Runs each morning (see createTriggers): emails every agent who has NOT yet logged anything
 * today a reminder with their private entry link, so they can tap straight into their form.
 * Agents who already submitted today are skipped - this is a nudge, not a repeat notification.
 * Requires the APP_TOKEN_SECRET and APP_BASE_URL script properties (see the Links section).
 */
function sendDailyEntryReminders() {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  getAgentsList().forEach(function (agent) {
    var today = buildMonthlyStats_(agent.email, todayStr, todayStr);
    if (Object.keys(today.perTask).length > 0) return; // already logged today
    sendDailyEntryReminderEmail_(agent, false);
  });
}

/**
 * Sends a real reminder email, right now, to every current agent, regardless of whether
 * they've already logged today - for testing delivery/formatting and, importantly, for
 * confirming each link actually works: click it and it should land on that agent's own form.
 * Cross-check: the token in the link should exactly match what /admin shows for that agent.
 */
function sendTestDailyEntryReminder() {
  var agents = getAgentsList();
  if (agents.length === 0) {
    Logger.log('No agents found - add rows to AGENTS first.');
    return;
  }
  agents.forEach(function (agent) {
    sendDailyEntryReminderEmail_(agent, true);
    Logger.log(agent.email + ' -> ' + buildEntryLink_(agent.email));
  });
  Logger.log('Test reminder sent - compare each logged link above against /admin for that agent.');
}

function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
