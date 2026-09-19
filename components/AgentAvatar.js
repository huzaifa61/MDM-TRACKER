import { useState } from 'react';

function initials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

// Plain <img>, not next/image: profile picture URLs are arbitrary agent-pasted links on
// domains that can't be known/allowlisted ahead of time in next.config.js.
export default function AgentAvatar({ name, src, size = 48 }) {
  const [failed, setFailed] = useState(false);
  const dimension = `${size}px`;

  if (!src || failed) {
    return (
      <div
        className="avatar avatar--fallback"
        style={{ width: dimension, height: dimension, fontSize: size * 0.4 }}
        aria-label={name}
      >
        {initials(name)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      className="avatar"
      style={{ width: dimension, height: dimension }}
      onError={() => setFailed(true)}
    />
  );
}
