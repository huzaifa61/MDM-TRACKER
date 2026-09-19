// Timezone-safe "today" as YYYY-MM-DD. Never use a bare `new Date()` for this elsewhere -
// Vercel functions run in UTC, so a naive local-date read can land on the wrong calendar day
// right around midnight in the configured business timezone.
export function todayInTZ(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
