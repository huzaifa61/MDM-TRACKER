import AgentAvatar from './AgentAvatar';

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

export default function Top3Banner({ top3, weekEnded }) {
  if (!top3 || top3.length === 0) {
    return (
      <div className="top3-banner top3-banner--empty">
        <p>No completed week yet — be the first to make the leaderboard!</p>
      </div>
    );
  }

  return (
    <div className="top3-banner">
      <h2>Top performers — week ended {weekEnded}</h2>
      <ol className="top3-list">
        {top3.map((agent, i) => (
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
    </div>
  );
}
