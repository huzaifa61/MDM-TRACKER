import { fetchAllSheetData, writeResponseRow } from '@/lib/sheets';
import { resolveAgentFromToken, normalizeEmail } from '@/lib/tokens';
import { computeDailyTotal } from '@/lib/points';
import { todayInTZ } from '@/lib/week';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { token, values } = req.body || {};
  if (!token || typeof values !== 'object' || values === null) {
    return res.status(400).json({ error: 'bad_request' });
  }

  let data;
  try {
    data = await fetchAllSheetData();
  } catch (err) {
    console.error('submit: failed to read sheet', err);
    return res.status(502).json({ error: 'sheet_read_failed' });
  }

  // Identity always comes from the token, never from anything the client claims in the body.
  const agent = resolveAgentFromToken(token, data.agents);
  if (!agent) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const { header, tasks, responseRows } = data;
  if (!header.length || header.indexOf('Agent Email') === -1 || header.indexOf('Date') === -1) {
    return res.status(500).json({ error: 'response_sheet_misconfigured' });
  }

  const timeZone = process.env.APP_TIMEZONE || 'Asia/Dubai';
  const targetDate = todayInTZ(timeZone);
  const dailyTotal = computeDailyTotal(values, header, tasks);

  const rowValues = header.map((col) => {
    if (col === 'Agent Name') return agent.name;
    if (col === 'Agent Email') return agent.email;
    if (col === 'Date') return targetDate;
    if (col === 'Daily Totals') return dailyTotal;
    const v = values[col];
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(v);
    return Number.isNaN(n) ? '' : n;
  });

  const targetEmail = normalizeEmail(agent.email);
  const existing = responseRows.find((r) => r.email === targetEmail && r.date === targetDate);

  try {
    await writeResponseRow({
      header,
      existingSheetRow: existing ? existing.sheetRow : null,
      rowValues,
    });
  } catch (err) {
    console.error('submit: failed to write row', err);
    return res.status(502).json({ error: 'sheet_write_failed' });
  }

  return res.status(200).json({ ok: true, dailyTotal, date: targetDate });
}
