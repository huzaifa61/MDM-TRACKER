import { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { fetchAllSheetData } from '@/lib/sheets';
import { resolveAgentFromToken, normalizeEmail } from '@/lib/tokens';
import { FIXED_RESPONSE_COLUMNS } from '@/lib/sheetSchema';
import { currentMonthBounds, previousMonthBounds } from '@/lib/leaderboard';
import AgentAvatar from '@/components/AgentAvatar';

function isHiddenHistoryColumn(column) {
  const normalized = String(column || '').trim().toLowerCase();
  return normalized.includes('choose your enemies wisely')
    || normalized.includes('post a minimum of once per day about your business on facebook');
}

export async function getServerSideProps({ params }) {
  const { token } = params;

  let data;
  try {
    data = await fetchAllSheetData();
  } catch (err) {
    console.error('history: failed to read sheet', err);
    return { props: { error: 'sheet_unavailable' } };
  }

  const agent = resolveAgentFromToken(token, data.agents);
  if (!agent) {
    return { props: { error: 'invalid_token' } };
  }

  const targetEmail = normalizeEmail(agent.email);
  const taskColumns = data.header.filter(
    (col) => !FIXED_RESPONSE_COLUMNS.includes(col) && !isHiddenHistoryColumn(col)
  );
  const totalIdx = data.header.indexOf('Daily Totals');

  const entries = data.responseRows
    .filter((r) => r.email === targetEmail)
    .map((r) => {
      const values = {};
      taskColumns.forEach((col) => {
        const idx = data.header.indexOf(col);
        const cell = r.raw[idx];
        values[col] = cell === undefined || cell === null || cell === '' ? 0 : cell;
      });
      return {
        date: r.date,
        values,
        dailyTotal: totalIdx >= 0 ? Number(r.raw[totalIdx]) || 0 : 0,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

  const lifetimeTotal = entries.reduce((sum, e) => sum + e.dailyTotal, 0);
  const timeZone = process.env.APP_TIMEZONE || 'America/Edmonton';

  return {
    props: {
      agent: { name: agent.name, profilePictureLink: agent.profilePictureLink || '' },
      token,
      taskColumns,
      entries,
      lifetimeTotal,
      periods: {
        thisMonth: currentMonthBounds(timeZone),
        lastMonth: previousMonthBounds(timeZone),
      },
    },
  };
}

const HISTORY_FILTERS = [
  { key: 'all', label: 'All history' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'custom', label: 'Custom dates' },
];

export default function HistoryPage({
  error,
  agent,
  token,
  taskColumns = [],
  entries = [],
  lifetimeTotal = 0,
  periods = {},
}) {
  const [filter, setFilter] = useState('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customRange, setCustomRange] = useState(null);
  const [rangeError, setRangeError] = useState('');

  const activeRange = filter === 'thisMonth'
    ? periods?.thisMonth
    : filter === 'lastMonth'
      ? periods?.lastMonth
      : filter === 'custom'
        ? customRange
        : null;

  const visibleEntries = useMemo(() => {
    if (!activeRange) return filter === 'custom' ? [] : entries;
    return entries.filter((entry) => entry.date >= activeRange.start && entry.date <= activeRange.end);
  }, [activeRange, entries, filter]);

  const visibleTotal = useMemo(
    () => visibleEntries.reduce((sum, entry) => sum + entry.dailyTotal, 0),
    [visibleEntries]
  );

  function applyCustomRange(e) {
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
    setCustomRange({ start: customStart, end: customEnd });
  }

  if (error) {
    const message =
      error === 'sheet_unavailable'
        ? 'Something went wrong loading your history. Please try again shortly.'
        : "This link isn't valid. Please contact your admin for a new one.";
    return (
      <main className="entry-page entry-page--error">
        <Head>
          <title>MDM Accountability Tracker</title>
        </Head>
        <p>{message}</p>
      </main>
    );
  }

  return (
    <main className="history-page">
      <Head>
        <title>Your history — {agent.name}</title>
      </Head>
      <Link href={`/entry/${token}`} className="history-back-link">
        ← Back to today&apos;s form
      </Link>
      <div className="history-header">
        <AgentAvatar name={agent.name} src={agent.profilePictureLink} size={56} />
        <div>
          <h1>{agent.name}&apos;s history</h1>
          <p className="history-lifetime-total">{lifetimeTotal} pts all-time · {entries.length} day{entries.length === 1 ? '' : 's'} logged</p>
        </div>
      </div>

      <div className="history-filter-row">
        {HISTORY_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`history-filter-btn ${filter === item.key ? 'history-filter-btn--active' : ''}`}
            onClick={() => {
              setFilter(item.key);
              setRangeError('');
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {filter === 'custom' && (
        <form className="history-date-range-form" onSubmit={applyCustomRange}>
          <label>
            From
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </label>
          <button type="submit">Apply</button>
        </form>
      )}
      {rangeError && <p className="history-range-error">{rangeError}</p>}

      {activeRange && (
        <p className="history-period-label">{activeRange.start} → {activeRange.end}</p>
      )}
      <p className="history-view-total">
        {filter === 'all' ? lifetimeTotal : visibleTotal} pts · {visibleEntries.length} day{visibleEntries.length === 1 ? '' : 's'} logged
      </p>

      {visibleEntries.length === 0 ? (
        <p>{filter === 'custom' && !customRange
          ? 'Choose a From and To date, then select Apply.'
          : 'No activity was logged in this period.'}</p>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Date</th>
                {taskColumns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((e) => (
                <tr key={e.date}>
                  <td>{e.date}</td>
                  {taskColumns.map((col) => (
                    <td key={col}>{e.values[col] || 0}</td>
                  ))}
                  <td className="history-total-cell">{e.dailyTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
