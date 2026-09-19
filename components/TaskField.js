export default function TaskField({ task, inputType, value, onChange }) {
  const isCheckbox = (inputType || 'Number').toLowerCase() === 'checkbox';

  if (isCheckbox) {
    return (
      <label className="task-field task-field--checkbox">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked ? 1 : 0)}
        />
        <span>{task}</span>
      </label>
    );
  }

  return (
    <label className="task-field">
      <span>{task}</span>
      <input
        type="number"
        min="0"
        inputMode="numeric"
        value={value === undefined || value === null ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </label>
  );
}
