// Talks to the spreadsheet via the Apps Script Web App (apps-script/WebApi.gs) instead of the
// Google Sheets API directly - no Google Cloud service account needed. See that file for the
// doGet/doPost contract this mirrors.

function appsScriptUrl() {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) throw new Error('APPS_SCRIPT_URL is not set');
  return url;
}

function sharedSecret() {
  const secret = process.env.APPS_SCRIPT_SHARED_SECRET;
  if (!secret) throw new Error('APPS_SCRIPT_SHARED_SECRET is not set');
  return secret;
}

// Apps Script formats real Date-typed cells to plain "yyyy-MM-dd" text before ever sending
// JSON back (see normalizeRowForJson_ in WebApi.gs), so this is mostly a pass-through; still
// defensive against an unexpected type showing up in a cell.
function normalizeDateCell(cell) {
  if (cell === undefined || cell === null || cell === '') return '';
  return String(cell).trim();
}

function normalizeCoreData(raw) {
  const agents = (raw.agents || []).map((a) => ({
    email: String(a.email || '').trim(),
    name: a.name ? String(a.name).trim() : '',
    profilePictureLink: a.profilePictureLink ? String(a.profilePictureLink).trim() : '',
  }));

  const tasks = (raw.tasks || []).map((t) => ({
    task: String(t.task || '').trim(),
    point: t.point === undefined || t.point === null || t.point === '' ? null : Number(t.point),
    inputType: t.inputType ? String(t.inputType).trim() : 'Number',
  }));

  const header = (raw.header || []).map((h) => String(h).trim()).filter(Boolean);
  const emailIdx = header.indexOf('Agent Email');
  const dateIdx = header.indexOf('Date');

  const responseRows = (raw.responseData || [])
    .map((row, i) => ({
      sheetRow: i + 2, // 1-indexed sheet row, +1 to skip the header row
      email: emailIdx >= 0 ? String(row[emailIdx] || '').trim().toLowerCase() : '',
      date: dateIdx >= 0 ? normalizeDateCell(row[dateIdx]) : '',
      raw: row,
    }))
    .filter((r) => r.email && r.date);

  const summary = (raw.summaryData || [])
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      weekEnded: normalizeDateCell(row[0]),
      agentName: row[1] ? String(row[1]).trim() : '',
      agentEmail: row[2] ? String(row[2]).trim().toLowerCase() : '',
      weeklyTotal: Number(row[3]) || 0,
      weeklyAvgPerDay: Number(row[4]) || 0,
      rank: row[5] !== undefined && row[5] !== '' ? Number(row[5]) : null,
    }));

  return { agents, tasks, header, responseRows, summary };
}

// Single call covering everything any page/API route needs (agents, tasks, RESPONSE header +
// data, Summary) - one round trip to Apps Script instead of several.
export async function fetchAllSheetData() {
  const url = new URL(appsScriptUrl());
  url.searchParams.set('secret', sharedSecret());
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Apps Script GET failed with status ${res.status}`);
  const raw = await res.json();
  if (raw.error) throw new Error(`Apps Script returned error: ${raw.error}`);
  return normalizeCoreData(raw);
}

export async function writeResponseRow({ header, existingSheetRow, rowValues }) {
  const res = await fetch(appsScriptUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: sharedSecret(),
      action: 'writeRow',
      header,
      existingSheetRow,
      rowValues,
    }),
  });
  if (!res.ok) throw new Error(`Apps Script POST failed with status ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`Apps Script returned error: ${body.error}`);
}
