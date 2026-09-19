import { useState, useEffect } from 'react';
import Head from 'next/head';
import AgentAvatar from '@/components/AgentAvatar';

async function fetchAgents() {
  const res = await fetch('/api/admin/agents');
  if (!res.ok) return { ok: false };
  const body = await res.json();
  return { ok: true, agents: body.agents };
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState('');
  const [copiedEmail, setCopiedEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAgents().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setAgents(result.agents);
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
      <h1>Agents &amp; private entry links</h1>
      <p>Send each agent only their own link — anyone holding a link can submit as that agent.</p>
      <table className="admin-table">
        <thead>
          <tr>
            <th aria-label="Avatar" />
            <th>Name</th>
            <th>Email</th>
            <th>Link</th>
            <th aria-label="Copy" />
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.email}>
              <td>
                <AgentAvatar name={a.name} src={a.profilePictureLink} size={32} />
              </td>
              <td>{a.name}</td>
              <td>{a.email}</td>
              <td>
                <code>{a.link}</code>
              </td>
              <td>
                <button type="button" onClick={() => copyLink(a.link, a.email)}>
                  {copiedEmail === a.email ? 'Copied!' : 'Copy'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {agents.length === 0 && <p>No agents found in the AGENTS sheet yet.</p>}
    </main>
  );
}
