import { useState, useEffect } from 'react';
import Head from 'next/head';
import AgentAvatar from '@/components/AgentAvatar';
import Top3Banner from '@/components/Top3Banner';

const TIER_LABELS = { top: 'Top performers', mid: 'Mid performers', low: 'Needs improvement' };
const TIER_ORDER = ['top', 'mid', 'low'];

const DEFAULT_PERFORMANCE = {
  top3: [],
  weekEnded: null,
  lastWeek: { weekEnded: null, ranked: [] },
  thisWeek: { start: null, end: null, ranked: [] },
  thisMonth: { start: null, end: null, ranked: [] },
  lastMonth: { start: null, end: null, ranked: [] },
  customRange: { start: null, end: null, ranked: [] },
};

const FILTERS = [
  { key: 'top3', label: 'Top 3' },
  { key: 'lastWeek', label: 'All agents — last week' },
  { key: 'thisWeek', label: 'All agents — this week (live)' },
  { key: 'thisMonth', label: 'All agents — this month' },
  { key: 'lastMonth', label: 'All agents — last month' },
  { key: 'customRange', label: 'Custom date range' },
];

async function fetchAgents(start, end) {
  const query = start && end
    ? `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    : '';
  const res = await fetch(`/api/admin/agents${query}`);
  if (!res.ok) return { ok: false };
  const body = await res.json();
  return { ok: true, agents: body.agents, performance: body.performance };
}

function TieredRanking({ ranked, emptyMessage }) {
  if (ranked.length === 0) return <p>{emptyMessage}</p>;
  return TIER_ORDER.map((tier) => {
    const rows = ranked.filter((r) => r.tier === tier);
    if (rows.length === 0) return null;
    return (
      <div key={tier} className={`tier-group tier-group--${tier}`}>
        <h3>{TIER_LABELS[tier]}</h3>
        {rows.map((r) => (
          <div className="tier-row" key={r.email}>
            <AgentAvatar name={r.name} src={r.profilePictureLink} size={32} />
            <span className="tier-row-name">{r.name}</span>
            <span className="tier-row-points">{r.total} pts</span>
          </div>
        ))}
      </div>
    );
  });
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [agents, setAgents] = useState([]);
  const [performance, setPerformance] = useState(DEFAULT_PERFORMANCE);
  const [filter, setFilter] = useState('top3');
  const [error, setError] = useState('');
  const [copiedEmail, setCopiedEmail] = useState('');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAgents().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setAgents(result.agents);
        setPerformance(result.performance || DEFAULT_PERFORMANCE);
        setAuthed(true);
      } else {
        setAuthed(false);
      }
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const result = await fetchAgents();
      if (result.ok) {
        setAgents(result.agents);
        setPerformance(result.performance || DEFAULT_PERFORMANCE);
        setAuthed(true);
      }
    } else {
      setError('Incorrect password');
    }
  }

  async function copyLink(link, email) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(''), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) - the link is still selectable text.
    }
  }

  async function loadCustomRange(e) {
    e.preventDefault();
    setRangeError('');
    if (!customStart || !customEnd) {
      setRangeError('Choose both a From date and a To date.');
      return;
    }
    if (customStart > customEnd) {
      setRangeError('The From date must be before or equal to the To date.');
      return;
    }

    setRangeLoading(true);
    let result;
    try {
      result = await fetchAgents(customStart, customEnd);
    } catch {
      result = { ok: false };
    } finally {
      setRangeLoading(false);
    }
    if (!result.ok) {
      setRangeError('Could not load that date range. Please try again.');
      return;
    }
    setAgents(result.agents);
    setPerformance(result.performance || DEFAULT_PERFORMANCE);
  }

  if (!checked) return null;

  if (!authed) {
    return (
      <main className="admin-page admin-page--login">
        <Head>
          <title>Admin — MDM Tracker</title>
        </Head>
        <form onSubmit={handleLogin}>
          <h1>Admin login</h1>
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">Log in</button>
          {error && <p className="admin-error">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <Head>
        <title>Admin — MDM Tracker</title>
      </Head>

      <section className="admin-section">
        <h1>Performance</h1>
        <div className="admin-filter-row">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`admin-filter-btn ${filter === f.key ? 'admin-filter-btn--active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filter === 'top3' && (
          <Top3Banner
            top3={performance.top3}
            weekEnded={performance.weekEnded}
            lastMonthTop3={performance.lastMonth.ranked.filter((r) => r.total > 0).slice(0, 3)}
            lastMonthStart={performance.lastMonth.start}
          />
        )}
        {filter === 'lastWeek' && (
          <>
            {performance.lastWeek.weekEnded && (
              <p className="admin-period-label">Week ended {performance.lastWeek.weekEnded}</p>
            )}
            <TieredRanking
              ranked={performance.lastWeek.ranked}
              emptyMessage="No completed week yet — check back after the first Monday rollup."
            />
          </>
        )}
        {filter === 'thisWeek' && (
          <>
            {performance.thisWeek.start && (
              <p className="admin-period-label">
                {performance.thisWeek.start} → {performance.thisWeek.end} (in progress)
              </p>
            )}
            <TieredRanking
              ranked={performance.thisWeek.ranked}
              emptyMessage="No activity logged yet this week."
            />
          </>
        )}
        {filter === 'thisMonth' && (
          <>
            {performance.thisMonth.start && (
              <p className="admin-period-label">
                {performance.thisMonth.start} → {performance.thisMonth.end} (in progress)
              </p>
            )}
            <TieredRanking
              ranked={performance.thisMonth.ranked}
              emptyMessage="No activity logged yet this month."
            />
          </>
        )}
        {filter === 'lastMonth' && (
          <>
            {performance.lastMonth.start && (
              <p className="admin-period-label">
                {performance.lastMonth.start} → {performance.lastMonth.end}
              </p>
            )}
            <TieredRanking
              ranked={performance.lastMonth.ranked}
              emptyMessage="No activity was logged last month."
            />
          </>
        )}
        {filter === 'customRange' && (
          <>
            <form className="admin-date-range-form" onSubmit={loadCustomRange}>
              <label>
                From
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </label>
              <button type="submit" disabled={rangeLoading}>
                {rangeLoading ? 'Loading…' : 'Apply'}
              </button>
            </form>
            {rangeError && <p className="admin-error">{rangeError}</p>}
            {performance.customRange.start && (
              <>
                <p className="admin-period-label">
                  {performance.customRange.start} → {performance.customRange.end}
                </p>
                <TieredRanking
                  ranked={performance.customRange.ranked}
                  emptyMessage="No activity was logged in this date range."
                />
              </>
            )}
          </>
        )}
      </section>

      <section className="admin-section">
        <h1>Agents &amp; private entry links</h1>
        <p>Send each agent only their own link — anyone holding a link can submit as that agent.</p>
        <div className="admin-agent-list">
          {agents.map((a) => (
            <div className="admin-agent-card" key={a.email}>
              <div className="admin-agent-card-header">
                <AgentAvatar name={a.name} src={a.profilePictureLink} size={40} />
                <div className="admin-agent-identity">
                  <div className="admin-agent-name-row">
                    <div className="admin-agent-name">{a.name}</div>
                    <a
                      className="admin-agent-edit-link"
                      href={a.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${a.name || a.email}'s entry form in a new tab`}
                      title="Open entry form in a new tab"
                    >
                      ✎
                    </a>
                  </div>
                  <div className="admin-agent-email">{a.email}</div>
                </div>
              </div>
              <div className="admin-agent-link-row">
                <code className="admin-agent-link">{a.link}</code>
                <button type="button" onClick={() => copyLink(a.link, a.email)}>
                  {copiedEmail === a.email ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          ))}
        </div>
        {agents.length === 0 && <p>No agents found in the AGENTS sheet yet.</p>}
      </section>
    </main>
  );
}
