import { useState } from 'react';
import { Link } from 'react-router-dom';

const STATUS_COLOR = {
  ok:      'bg-green-500',
  warning: 'bg-amber-400',
  low:     'bg-red-500',
  over:    'bg-red-500',
};
const LABEL_COLOR = {
  ok:      'text-green-700',
  warning: 'text-amber-600',
  low:     'text-red-600',
  over:    'text-red-600',
};

export default function NutrientBar({
  label, unit, target, targetType, actual, pct, status,
  contributor,
  // Optional: explanation from Claude
  explanation, suggestions,
}) {
  const [expanded, setExpanded] = useState(false);
  const barPct        = Math.min(pct ?? 0, 100);
  const displayActual = typeof actual === 'number' ? Math.round(actual * 10) / 10 : actual;
  const hasExplain    = explanation || (suggestions?.length > 0);
  const isFlagged     = status !== 'ok';

  return (
    <div className="mb-3">
      {/* Bar row */}
      <div className="flex justify-between text-xs mb-1">
        <span className="flex items-center gap-1 text-gray-700 font-medium">
          {label}
          {hasExplain && isFlagged && (
            <button
              onClick={() => setExpanded(v => !v)}
              title={expanded ? 'Hide explanation' : 'Show Claude explanation'}
              className="text-violet-500 hover:text-violet-700 leading-none"
            >
              {expanded ? '▾' : '▸'}
            </button>
          )}
        </span>
        <span className={LABEL_COLOR[status] ?? 'text-gray-500'}>
          {displayActual} {unit} {targetType === 'min' ? `/ ≥${target}` : `/ ≤${target}`} {unit}
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${STATUS_COLOR[status] ?? 'bg-gray-400'}`}
          style={{ width: `${barPct}%` }}
        />
      </div>
      {contributor && (
        <p className="text-[10px] text-gray-400 mt-0.5">mostly from {contributor}</p>
      )}

      {/* Explanation panel */}
      {expanded && hasExplain && (
        <div className="mt-2 rounded-md bg-violet-50 border border-violet-100 p-2.5 text-xs text-gray-700 space-y-2">
          {explanation && <p>{explanation}</p>}
          {suggestions?.length > 0 && (
            <ul className="space-y-1.5">
              {suggestions.map((s, i) => (
                <li key={i} className="flex flex-col gap-0.5">
                  <span className="font-medium text-violet-800">
                    <Link
                      to={`/recipes/${s.recipe_id}`}
                      className="hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      {s.recipe_name}
                    </Link>
                    {' '}— {s.action}
                  </span>
                  <span className="text-gray-500">{s.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
