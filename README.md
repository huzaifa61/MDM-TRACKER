# MDM Accountability Tracker

Daily activity form + leaderboard for the "MDM Accountability Tracker" Google Sheet, deployed
as a Next.js app on Vercel. Sheet automation (keeping columns in sync, weekly/monthly rollups,
and emails) runs separately as Google Apps Script, bound to the spreadsheet itself.

See [`.claude/plans`](~/.claude/plans/i-need-frontend-in-squishy-spark.md) — or ask Claude — for
the full design rationale. This README is the practical setup checklist.

## How it fits together

- **This Next.js app** (deploy to Vercel): agents open a private `/entry/<token>` link to log
  today's activity; `/admin` (password-gated) lists every agent's link. It reads/writes the
  spreadsheet by calling the Apps Script Web App below over HTTP — **no Google Cloud service
  account needed**.
- **`apps-script/Code.gs`** (paste into the spreadsheet's Extensions > Apps Script editor,
  separately from this app — this is the only file in that project): keeps RESPONSE's columns
  in sync with TASKS, recomputes Daily Total as a safety net, exposes a small `doGet`/`doPost`
  API that the Next.js app calls, and sends four kinds of email — a morning reminder with the
  agent's own entry link (skipped if they've already logged today), an evening confirmation of
  what they logged, the weekly personalized round (shared Top 3 + their own week), and the
  monthly summary. It independently recomputes each agent's private link token (same algorithm
  as `lib/tokens.js`, different runtime) so it never has to call the frontend to send a reminder.

## One-time setup

### 1. Prepare the spreadsheet

1. Add a new sheet tab named exactly **Summary** (leave it empty — Apps Script writes its
   header in step 2).
2. Confirm File → Settings → the sheet's timezone — it must match `APP_TIMEZONE` below.
3. Optional, needed for the monthly email's contacts/appointments/conversion% section: add
   TASKS rows whose names contain those words, e.g. "Appointments Booked" and "Successful
   Client Conversion". Without them, that section of the monthly email is simply omitted.

### 2. Apps Script

1. Open the sheet → Extensions → Apps Script.
2. Paste [`apps-script/Code.gs`](apps-script/Code.gs) over the default `Code.gs` content.
3. Run `ensureSummarySheetHeader` once from the function dropdown.
4. Run `createTriggers` once. Approve the OAuth consent screen when prompted — the "Google
   hasn't verified this app" warning is expected for a script only you run (Advanced → Go to
   the project, to proceed). Re-running `createTriggers` later is always safe; it clears old
   triggers first so nothing ever double-fires.
5. Project Settings (gear icon, left sidebar) → Script Properties → add **three** properties:
   - `SHARED_SECRET` — long random string (e.g. `openssl rand -base64 48`). Stops anyone who
     finds the Web App URL from reading or writing your sheet without it.
   - `APP_TOKEN_SECRET` — must be the **exact same value** as the frontend's `APP_TOKEN_SECRET`
     env var (see step 3 below). This lets Apps Script compute the same private `/entry/<token>`
     link the frontend would, so reminder emails work without ever calling the frontend.
   - `APP_BASE_URL` — your frontend's URL, e.g. `https://your-app.vercel.app` (no trailing
     slash). Used to build the clickable link in reminder emails.
6. Deploy → New deployment → gear icon → type **Web app**. Execute as **Me**, Who has access
   **Anyone**. Click Deploy, then copy the resulting URL (ends in `/exec`) — that's
   `APPS_SCRIPT_URL` below. ("Anyone" is required since Vercel has no Google identity to
   authenticate as; the `SHARED_SECRET` check is what keeps the endpoint private in practice.)
7. Sanity check: open `<that URL>?secret=<your SHARED_SECRET>` directly in a browser — you
   should see a JSON dump of your agents/tasks/response/summary data, not an error.
8. Run `runSelfTest` once and check the Execution Log for any WARNING lines (duplicate
   columns, a missing Summary tab, a missing secret/token/base-URL property). It also logs a
   sample entry link — compare it against what `/admin` shows for the same agent to confirm
   the token matches before trusting real reminder emails.
9. Try `sendTestDailyEntryReminder` — it emails every agent immediately with a real, working
   link (marked as a test). Click it yourself to confirm it actually lands on that agent's form.

Whenever you edit the Apps Script code later, use **Deploy → Manage deployments → edit (pencil)
→ New version** — just saving the file does not update the live `/exec` URL.

### 3. Environment variables

Copy `.env.example` to `.env.local` for local dev, and set the same variables in the Vercel
project dashboard (Settings → Environment Variables) for Production/Preview/Development:

| Variable | Value |
|---|---|
| `APPS_SCRIPT_URL` | The `/exec` URL from step 2.6 |
| `APPS_SCRIPT_SHARED_SECRET` | The same value as the `SHARED_SECRET` script property |
| `APP_TOKEN_SECRET` | `openssl rand -base64 48` |
| `ADMIN_PASSWORD` | Your choice — gates `/admin` |
| `APP_BASE_URL` | `http://localhost:3000` locally, your Vercel URL in production |
| `APP_TIMEZONE` | IANA zone, e.g. `Asia/Dubai` — must match the spreadsheet's timezone |

### 4. Run locally, then deploy

```bash
npm install
npm run dev
```

Visit `http://localhost:3000/admin`, log in, confirm both current agents show up with working
links, open one in an incognito window, and submit a test entry.

Then push to GitHub, import the repo into Vercel, set the environment variables from step 3,
and deploy.

## Notes / known gaps

- **`SHARED_SECRET` and `APP_TOKEN_SECRET` are both single points of failure** — treat them
  like passwords. `SHARED_SECRET` leaking lets someone read/write the whole sheet directly;
  `APP_TOKEN_SECRET` leaking lets someone forge an agent's private link if they also know that
  agent's email. Rotating either means updating it in both places (Apps Script Script
  Properties / Vercel env vars) and, for `APP_TOKEN_SECRET`, redistributing every `/entry/<token>`
  link from `/admin` afterwards.
- **Timezone and date format**: dates this app writes are plain `YYYY-MM-DD` text (chosen
  deliberately to avoid locale ambiguity); Apps Script formats any real Date-typed cells to
  the same plain text using the spreadsheet's own timezone before sending JSON back, so the
  frontend never has to guess a date format. If "today" ever looks off by one day, double
  check `APP_TIMEZONE` matches the sheet's timezone.
- **Private links, not accounts**: whoever holds an `/entry/<token>` link can submit as that
  agent. Ask agents to share their link only privately (e.g. DM, not a group channel), since
  some chat apps auto-fetch link previews — including the reminder emails, which now put that
  same link directly in the email body.
- **Daily email cadence**: a reminder goes out at 9am to anyone who hasn't logged yet that day;
  a confirmation goes out at 8pm to anyone who did. An agent who logs early enough only gets
  the evening one. Both times are set in `createTriggers` (`.atHour(9)` / `.atHour(20)`) if you
  want to change them.
- A rare double-submit race (e.g. a double click) is mitigated by disabling the submit button
  on click and Apps Script's hourly de-duplication pass — not fully eliminated, but self-healing
  within about an hour if it ever happens.
- Apps Script Web Apps have their own quotas (URL Fetch/execution limits) separate from the
  Sheets API ones — not a concern at this team's scale, but worth knowing if usage grows a lot.
# MDM-TRACKER
