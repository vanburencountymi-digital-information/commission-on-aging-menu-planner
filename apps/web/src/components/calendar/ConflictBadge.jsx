import { useState } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';

export default function ConflictBadge({ conflicts }) {
  const [open, setOpen] = useState(false);
  if (!conflicts?.length) return null;

  const hasError = conflicts.some(c => c.severity === 'ERROR');
  const Icon = hasError ? AlertCircle : AlertTriangle;
  const iconClass = hasError ? 'text-red-500' : 'text-amber-500';

  return (
    <div className="relative">
      <button
        className={`${iconClass} hover:opacity-75`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={e => e.stopPropagation()}
      >
        <Icon size={13} />
      </button>

      {open && (
        <div className="absolute right-0 top-5 z-50 w-64 bg-white border border-gray-200 rounded-md shadow-lg p-2 space-y-1">
          {conflicts.map(c => (
            <div
              key={c.id}
              className={`text-xs p-1.5 rounded ${
                c.severity === 'ERROR'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              <span className="font-semibold">{c.severity}:</span> {c.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
