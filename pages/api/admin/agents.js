import { fetchAllSheetData } from '@/lib/sheets';
import { generateToken } from '@/lib/tokens';
import { isAdminRequest } from '@/lib/adminAuth';
import {
  computeWeeklyLeaderboard,
  computeRangeLeaderboard,
  currentIsoWeekBounds,
  currentMonthBounds,
} from '@/lib/leaderboard';

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

  return res.status(200).json({
    agents,
    performance: {
      top3: lastWeek.ranked.slice(0, 3),
      weekEnded: lastWeek.weekEnded,
      lastWeek,
      thisWeek,
      thisMonth,
    },
  });
}
