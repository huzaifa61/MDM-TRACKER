import { fetchAllSheetData } from '@/lib/sheets';
import { generateToken } from '@/lib/tokens';
import { isAdminRequest } from '@/lib/adminAuth';
import {
  computeWeeklyLeaderboard,
  computeRangeLeaderboard,
  currentIsoWeekBounds,
  currentMonthBounds,
  previousMonthBounds,
} from '@/lib/leaderboard';

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export default async function handler(req, res) {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let data;
  try {
    data = await fetchAllSheetData();
  } catch (err) {
    console.error('admin/agents: failed to read sheet', err);
    return res.status(502).json({ error: 'sheet_read_failed' });
  }

  const baseUrl = process.env.APP_BASE_URL || '';
  const agents = data.agents.map((a) => ({
    ...a,
    link: `${baseUrl}/entry/${generateToken(a.email)}`,
  }));

  const timeZone = process.env.APP_TIMEZONE || 'America/Edmonton';
  const lastWeek = computeWeeklyLeaderboard(data.summary, data.agents);

  const thisWeekBounds = currentIsoWeekBounds(timeZone);
  const thisWeek = {
    start: thisWeekBounds.start,
    end: thisWeekBounds.end,
    ranked: computeRangeLeaderboard(data.responseRows, data.header, data.agents, thisWeekBounds.start, thisWeekBounds.end),
  };

  const thisMonthBounds = currentMonthBounds(timeZone);
  const thisMonth = {
    start: thisMonthBounds.start,
    end: thisMonthBounds.end,
    ranked: computeRangeLeaderboard(data.responseRows, data.header, data.agents, thisMonthBounds.start, thisMonthBounds.end),
  };

  const lastMonthBounds = previousMonthBounds(timeZone);
  const lastMonth = {
    start: lastMonthBounds.start,
    end: lastMonthBounds.end,
    ranked: computeRangeLeaderboard(data.responseRows, data.header, data.agents, lastMonthBounds.start, lastMonthBounds.end),
  };

  const requestedStart = Array.isArray(req.query.start) ? req.query.start[0] : req.query.start;
  const requestedEnd = Array.isArray(req.query.end) ? req.query.end[0] : req.query.end;
  let customRange = { start: null, end: null, ranked: [] };
  if (requestedStart || requestedEnd) {
    if (!isValidIsoDate(requestedStart) || !isValidIsoDate(requestedEnd) || requestedStart > requestedEnd) {
      return res.status(400).json({ error: 'invalid_date_range' });
    }
    customRange = {
      start: requestedStart,
      end: requestedEnd,
      ranked: computeRangeLeaderboard(data.responseRows, data.header, data.agents, requestedStart, requestedEnd),
    };
  }

  return res.status(200).json({
    agents,
    performance: {
      top3: lastWeek.ranked.slice(0, 3),
      weekEnded: lastWeek.weekEnded,
      lastWeek,
      thisWeek,
      thisMonth,
      lastMonth,
      customRange,
    },
  });
}
