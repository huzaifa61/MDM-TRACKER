import { useEffect, useState } from 'react';
import AgentAvatar from './AgentAvatar';

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

function monthLabel(start) {
  if (!start) return 'last month';
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${start}T00:00:00Z`));
}

export default function Top3Banner({ top3, weekEnded, lastMonthTop3 = [], lastMonthStart = null }) {
  const hasWeek = Boolean(top3 && top3.length);
  const hasLastMonth = Boolean(lastMonthTop3 && lastMonthTop3.length);
  const [showLastMonth, setShowLastMonth] = useState(!hasWeek && hasLastMonth);

  useEffect(() => {
    if (!hasWeek || !hasLastMonth) return undefined;
    const timer = window.setInterval(() => {
      setShowLastMonth((current) => !current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasWeek, hasLastMonth]);

  if (!hasWeek && !hasLastMonth) {
    return (
      <div className="top3-banner top3-banner--empty">
        <p>No completed week or month yet — be the first to make the leaderboard!</p>
      </div>
    );
  }

  const showingMonth = hasLastMonth && (showLastMonth || !hasWeek);
  const visibleTop3 = showingMonth ? lastMonthTop3 : top3;
  const title = showingMonth
    ? `Top performers — ${monthLabel(lastMonthStart)}`
    : `Top performers — week ended ${weekEnded}`;

  return (
    <div className="top3-banner" data-period={showingMonth ? 'last-month' : 'last-week'}>
      <h2>{title}</h2>
      <ol className="top3-list top3-list--rotating" key={showingMonth ? 'last-month' : 'last-week'}>
        {visibleTop3.map((agent, i) => (
          <li key={agent.name + i} className="top3-item">
            <span className="top3-medal">{MEDALS[i] || ''}</span>
            <AgentAvatar name={agent.name} src={agent.profilePictureLink} size={56} />
            <div className="top3-info">
              <span className="top3-name">{agent.name}</span>
              <span className="top3-points">{agent.total} pts</span>
            </div>
          </li>
        ))}
      </ol>
      {hasWeek && hasLastMonth && (
        <p className="top3-rotation-label">Showing {showingMonth ? 'last month' : 'last completed week'} · changes every second</p>
      )}
    </div>
  );
}
