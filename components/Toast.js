import { useEffect } from 'react';

export default function Toast({ message, tone = 'ok', onDone, duration = 2500 }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone && onDone(), duration);
    return () => clearTimeout(timer);
  }, [onDone, duration]);

  return (
    <div className={`toast toast--${tone}`} role="status">
      {message}
    </div>
  );
}
