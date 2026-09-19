import { useState } from 'react';
import Head from 'next/head';
import { fetchAllSheetData } from '@/lib/sheets';
import { resolveAgentFromToken, normalizeEmail } from '@/lib/tokens';
import { computeDailyTotal } from '@/lib/points';
import { todayInTZ } from '@/lib/week';
import { FIXED_RESPONSE_COLUMNS } from '@/lib/sheetSchema';
import Top3Banner from '@/components/Top3Banner';
import TaskField from '@/components/TaskField';

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

  const timeZone = process.env.APP_TIMEZONE || 'Asia/Dubai';
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

  const latestWeek = data.summary.reduce(
    (max, r) => (!max || r.weekEnded > max ? r.weekEnded : max),
    null
  );
  const top3 = data.summary
    .filter((r) => r.weekEnded === latestWeek)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, 3)
    .map((r) => {
      const match = data.agents.find((a) => normalizeEmail(a.email) === r.agentEmail);
      return {
        name: r.agentName,
        total: r.weeklyTotal,
        profilePictureLink: match ? match.profilePictureLink : '',
      };
    });

  const tasks = data.tasks.map((t) => ({ task: t.task, point: t.point, inputType: t.inputType }));

  return {
    props: {
      agent: { name: agent.name, email: agent.email },
      token,
      tasks,
      todayValues,
      today,
      top3,
      weekEnded: latestWeek || null,
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
      <h1>Hi {agent.name}, log today&apos;s activity</h1>
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
        {status === 'saved' && <p className="entry-status entry-status--ok">Saved!</p>}
        {status === 'error' && (
          <p className="entry-status entry-status--error">
            Could not save — please try again.
          </p>
        )}
      </form>
    </main>
  );
}
