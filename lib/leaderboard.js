import { normalizeEmail } from './tokens';
import { todayInTZ } from './week';

// Rank-based thirds rather than a fixed point threshold: stays sensible regardless of team
// size or how well everyone is doing (a ratio-to-average rule could label the whole team
// "top" in a great week, or everyone "low" in a slow one).
function tierForIndex(index, n) {
  if (n <= 1) return 'top';
  const cut = Math.max(1, Math.round(n / 3));
  if (index < cut) return 'top';
  if (index >= n - cut) return 'low';
  return 'mid';
}

function rankAndTier(entries) {
  const sorted = [...entries].sort((a, b) => b.total - a.total);
  const n = sorted.length;
  return sorted.map((e, i) => ({ ...e, rank: i + 1, tier: tierForIndex(i, n) }));
}

// Shared by the home page, entry page, and admin page so "who's on top this week" is computed
// exactly once. `summary` is Summary sheet rows (from lib/sheets.js), `agents` the AGENTS list.
export function computeWeeklyLeaderboard(summary, agents) {
  const latestWeek = (summary || []).reduce(
    (max, r) => (!max || r.weekEnded > max ? r.weekEnded : max),
    null
  );
  if (!latestWeek) return { weekEnded: null, ranked: [] };

  const rowsForWeek = summary
    .filter((r) => r.weekEnded === latestWeek)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  const n = rowsForWeek.length;
  const ranked = rowsForWeek.map((r, i) => {
    const agent = (agents || []).find((a) => normalizeEmail(a.email) === r.agentEmail);
    return {
      name: r.agentName,
      email: r.agentEmail,
      total: r.weeklyTotal,
      avgPerDay: r.weeklyAvgPerDay,
      rank: r.rank ?? i + 1,
      tier: tierForIndex(i, n),
      profilePictureLink: agent ? agent.profilePictureLink : '',
    };
  });

  return { weekEnded: latestWeek, ranked };
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The Monday-of-this-week through today - an in-progress week, not yet rolled up into Summary
// (that only happens Monday morning for the week that just finished).
export function currentIsoWeekBounds(timeZone) {
  const todayStr = todayInTZ(timeZone);
  const today = new Date(`${todayStr}T00:00:00`);
  const isoDay = today.getDay() === 0 ? 7 : today.getDay(); // 1=Mon..7=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (isoDay - 1));
  return { start: toISODate(monday), end: todayStr };
}

// The 1st of this month through today - an in-progress month, distinct from the "last fully
// completed month" stats the monthly email sends.
export function currentMonthBounds(timeZone) {
  const todayStr = todayInTZ(timeZone);
  const [y, m] = todayStr.split('-');
  return { start: `${y}-${m}-01`, end: todayStr };
}

// Sums each agent's Daily Total directly from RESPONSE rows within [start, end] - unlike
// computeWeeklyLeaderboard, this doesn't depend on anything having been rolled up into Summary
// yet, so it works for "this week so far" / "this month so far" live views.
export function computeRangeLeaderboard(responseRows, header, agents, start, end) {
  const totalIdx = header.indexOf('Daily Totals');
  const totals = {};

  (agents || []).forEach((a) => {
    const key = normalizeEmail(a.email);
    totals[key] = { name: a.name, email: key, total: 0, profilePictureLink: a.profilePictureLink || '' };
  });

  (responseRows || []).forEach((r) => {
    if (r.date < start || r.date > end) return;
    if (!totals[r.email]) {
      totals[r.email] = { name: '', email: r.email, total: 0, profilePictureLink: '' };
    }
    totals[r.email].total += totalIdx >= 0 ? Number(r.raw[totalIdx]) || 0 : 0;
  });

  return rankAndTier(Object.values(totals));
}
