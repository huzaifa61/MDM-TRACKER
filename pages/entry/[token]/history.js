import Head from 'next/head';
import Link from 'next/link';
import { fetchAllSheetData } from '@/lib/sheets';
import { resolveAgentFromToken, normalizeEmail } from '@/lib/tokens';
import { FIXED_RESPONSE_COLUMNS } from '@/lib/sheetSchema';
import AgentAvatar from '@/components/AgentAvatar';

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
  const taskColumns = data.header.filter((col) => !FIXED_RESPONSE_COLUMNS.includes(col));
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

  return {
    props: {
      agent: { name: agent.name, profilePictureLink: agent.profilePictureLink || '' },
      token,
      taskColumns,
      entries,
      lifetimeTotal,
    },
  };
}

export default function HistoryPage({ error, agent, token, taskColumns, entries, lifetimeTotal }) {
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

      {entries.length === 0 ? (
        <p>No activity logged yet — it&apos;ll show up here as soon as you save your first day.</p>
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
              {entries.map((e) => (
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
