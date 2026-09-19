import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { fetchAllSheetData } from '@/lib/sheets';
import { resolveAgentFromToken, normalizeEmail } from '@/lib/tokens';
import { computeDailyTotal } from '@/lib/points';
import { computeWeeklyLeaderboard } from '@/lib/leaderboard';
import { todayInTZ } from '@/lib/week';
import { FIXED_RESPONSE_COLUMNS } from '@/lib/sheetSchema';
import Top3Banner from '@/components/Top3Banner';
import TaskField from '@/components/TaskField';
import AgentAvatar from '@/components/AgentAvatar';
import Toast from '@/components/Toast';

export async function getServerSideProps({ params }) {
  const { token } = params;

  let data;
  try {
    data = await fetchAllSheetData();
  } catch (err) {
    console.error('entry: failed to read sheet', err);
    return { props: { error: 'sheet_unavailable' } };
  }

  const agent = resolveAgentFromToken(token, data.agents);
  if (!agent) {
    return { props: { error: 'invalid_token' } };
  }

  const timeZone = process.env.APP_TIMEZONE || 'America/Edmonton';
  const today = todayInTZ(timeZone);
  const targetEmail = normalizeEmail(agent.email);
  const existing = data.responseRows.find(
    (r) => r.email === targetEmail && r.date === today
  );

  const todayValues = {};
  if (existing) {
    data.header.forEach((col, idx) => {
      if (FIXED_RESPONSE_COLUMNS.includes(col)) return;
      const cell = existing.raw[idx];
      todayValues[col] = cell === undefined || cell === null ? '' : cell;
    });
  }

  const { weekEnded, ranked } = computeWeeklyLeaderboard(data.summary, data.agents);
  const top3 = ranked.slice(0, 3).map((r) => ({
    name: r.name,
    total: r.total,
    profilePictureLink: r.profilePictureLink,
  }));

  const tasks = data.tasks.map((t) => ({ task: t.task, point: t.point, inputType: t.inputType }));

  return {
    props: {
      agent: { name: agent.name, email: agent.email, profilePictureLink: agent.profilePictureLink || '' },
      token,
      tasks,
      todayValues,
      today,
      top3,
      weekEnded: weekEnded || null,
    },
  };
}

export default function EntryPage({
  error,
  agent,
  token,
  tasks,
  todayValues,
  today,
  top3,
  weekEnded,
}) {
  const [values, setValues] = useState(todayValues || {});
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error

  if (error) {
    const message =
      error === 'sheet_unavailable'
        ? "Something went wrong loading your form. Please try again shortly, or contact your admin if it persists."
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

  function updateValue(task, v) {
    setValues((prev) => ({ ...prev, [task]: v }));
    setStatus('idle');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('saving');
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, values }),
      });
      if (!res.ok) throw new Error('submit_failed');
      setStatus('saved');
    } catch (err) {
      setStatus('error');
    }
  }

  const liveTotal = computeDailyTotal(
    values,
    tasks.map((t) => t.task),
    tasks
  );

  return (
    <main className="entry-page">
      <Head>
        <title>Daily Log — {agent.name}</title>
      </Head>
      <Top3Banner top3={top3} weekEnded={weekEnded} />
      <Link href={`/entry/${token}/history`} className="entry-profile-link">
        <AgentAvatar name={agent.name} src={agent.profilePictureLink} size={48} />
        <span>
          <span className="entry-profile-name">Hi {agent.name}, log today&apos;s activity</span>
          <span className="entry-profile-cta">View your history →</span>
        </span>
      </Link>
      <p className="entry-date">{today}</p>
      <form onSubmit={handleSubmit} className="entry-form">
        {tasks.map((t) => (
          <TaskField
            key={t.task}
            task={t.task}
            inputType={t.inputType}
            value={values[t.task]}
            onChange={(v) => updateValue(t.task, v)}
          />
        ))}
        <div className="entry-total">
          Today&apos;s total: <strong>{liveTotal}</strong> pts
        </div>
        <button type="submit" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : "Save today's log"}
        </button>
      </form>
      {status === 'saved' && (
        <Toast message="Saved!" tone="ok" onDone={() => setStatus('idle')} />
      )}
      {status === 'error' && (
        <Toast message="Could not save — please try again." tone="error" onDone={() => setStatus('idle')} />
      )}
    </main>
  );
}
