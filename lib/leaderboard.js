import { normalizeEmail } from './tokens';

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
