import { FIXED_RESPONSE_COLUMNS } from './sheetSchema';

function toNumericAmount(raw) {
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : n;
}

// Daily Total = sum(enteredValue * matching TASKS.POINT, or *1 if that task has no POINT row).
// Mirrored in apps-script/Totals.gs - the two must stay in sync since Node and Apps Script
// can't share a module.
export function computeDailyTotal(values, columnNames, tasks) {
  const pointByTask = new Map(tasks.map((t) => [t.task, t.point]));
  let total = 0;
  for (const col of columnNames) {
    if (FIXED_RESPONSE_COLUMNS.includes(col)) continue;
    const numeric = toNumericAmount(values ? values[col] : undefined);
    const definedPoint = pointByTask.get(col);
    const point = definedPoint === undefined || definedPoint === null ? 1 : definedPoint;
    total += numeric * point;
  }
  return total;
}
