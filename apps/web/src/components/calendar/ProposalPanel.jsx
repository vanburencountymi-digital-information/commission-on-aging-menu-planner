import { useState, Component } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { menusApi } from '../../lib/api';

const MEAL_CHIP = {
  HOT:     'bg-orange-100 text-orange-700',
  COLD:    'bg-sky-100 text-sky-700',
  SIDE:    'bg-green-100 text-green-700',
  FRUIT:   'bg-pink-100 text-pink-700',
  BREAD:   'bg-yellow-100 text-yellow-800',
  DESSERT: 'bg-purple-100 text-purple-700',
};

export default function ProposalPanel({ proposal, menuId, menuDays, onClose }) {
  if (!proposal?.days?.length) {
    return (
      <aside className="w-96 flex-shrink-0 border-l bg-white flex flex-col h-full shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-violet-50 flex-shrink-0">
          <h2 className="text-sm font-semibold text-violet-900">AI Menu Proposal</h2>
          <button onClick={onClose} className="text-violet-400 hover:text-violet-600"><X size={16} /></button>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-gray-400">
          No suggestions were returned. Try generating again.
        </div>
      </aside>
    );
  }
  const qc = useQueryClient();
  const [accepted, setAccepted]   = useState(new Set());
  const [skipped, setSkipped]     = useState(new Set());
  const [accepting, setAccepting] = useState(new Set());
  const [errors, setErrors]       = useState({});

  // `?? []` only catches null/undefined — coerce non-arrays too so a malformed
  // proposal can never crash days.every() / days.map() inside the error boundary.
  const days = Array.isArray(proposal?.days) ? proposal.days : [];

  const dayIdByDate = Object.fromEntries(
    (menuDays ?? []).map(d => [String(d.service_date).slice(0, 10), d.id])
  );

  async function acceptDay(day) {
    const date  = day.service_date;
    const dayId = dayIdByDate[date];
    if (!dayId) return;

    setAccepting(prev => new Set(prev).add(date));
    setErrors(prev => { const n = { ...prev }; delete n[date]; return n; });

    try {
      for (const s of day.suggestions) {
        await menusApi.addItem(menuId, dayId, { recipe_id: s.recipe_id, meal_type: s.meal_type });
      }
      setAccepted(prev => new Set(prev).add(date));
      qc.invalidateQueries({ queryKey: ['menu'] });
      qc.invalidateQueries({ queryKey: ['nutrition'] });
    } catch (err) {
      setErrors(prev => ({
        ...prev,
        [date]: err?.response?.data?.error ?? 'Failed to apply — check for duplicate slots',
      }));
    } finally {
      setAccepting(prev => { const n = new Set(prev); n.delete(date); return n; });
    }
  }

  async function acceptAll() {
    for (const day of days) {
      if (!accepted.has(day.service_date) && !skipped.has(day.service_date)) {
        await acceptDay(day);
      }
    }
  }

  const allDone = days.length > 0 && days.every(
    d => accepted.has(d.service_date) || skipped.has(d.service_date)
  );

  return (
    <aside className="w-96 flex-shrink-0 border-l bg-white flex flex-col h-full shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-violet-50 flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-violet-900">AI Menu Proposal</h2>
          <p className="text-xs text-violet-500 mt-0.5">
            {days.length} days · review each before applying
          </p>
        </div>
        <button onClick={onClose} className="text-violet-400 hover:text-violet-600">
          <X size={16} />
        </button>
      </div>

      {/* Bulk actions */}
      {!allDone ? (
        <div className="flex gap-2 px-4 py-2 border-b bg-gray-50 flex-shrink-0">
          <button
            onClick={acceptAll}
            className="flex-1 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
          >
            Accept All
          </button>
          <button
            onClick={() => setSkipped(new Set(days.map(d => d.service_date)))}
            className="flex-1 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
          >
            Skip All
          </button>
        </div>
      ) : (
        <div className="px-4 py-2.5 bg-emerald-50 border-b flex-shrink-0">
          <p className="text-xs text-emerald-700 font-medium">
            All days reviewed. Close this panel to continue editing.
          </p>
        </div>
      )}

      {/* Day list */}
      <div className="flex-1 overflow-y-auto divide-y">
        {days.map(day => (
          <DayCardErrorBoundary key={day.service_date}>
          <DayCard
            day={day}
            isAccepted={accepted.has(day.service_date)}
            isSkipped={skipped.has(day.service_date)}
            isAccepting={accepting.has(day.service_date)}
            error={errors[day.service_date]}
            onAccept={() => acceptDay(day)}
            onSkip={() => setSkipped(prev => new Set(prev).add(day.service_date))}
          />
          </DayCardErrorBoundary>
        ))}
      </div>
    </aside>
  );
}

class DayCardErrorBoundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div className="px-4 py-2 text-xs text-red-500 border-b">
          Could not render this day — {String(this.state.err.message)}
        </div>
      );
    }
    return this.props.children;
  }
}

function DayCard({ day, isAccepted, isSkipped, isAccepting, error, onAccept, onSkip }) {
  const [open, setOpen] = useState(true);
  // Normalise to plain YYYY-MM-DD — Claude returns this format but DB values
  // may be full ISO strings; slicing prevents Invalid Date from date-fns.
  const dateStr = String(day.service_date ?? '').slice(0, 10);
  // Parse as LOCAL midnight (no trailing 'Z'): date-fns format() renders in
  // local time, so a UTC instant would display the previous day in any
  // negative-offset zone (e.g. Eastern shows May 1 as "Apr 30").
  const date = new Date(dateStr + 'T00:00:00');
  const suggestions = day.suggestions ?? [];

  return (
    <div className={isSkipped ? 'opacity-40' : ''}>
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {isAccepted && <Check size={13} className="text-emerald-500 flex-shrink-0" />}
          <span className={`text-sm font-medium ${isAccepted ? 'text-emerald-700' : 'text-gray-800'}`}>
            {format(date, 'EEE, MMM d')}
          </span>
          <span className="text-xs text-gray-400">{suggestions.length} items</span>
        </div>
        {open
          ? <ChevronUp size={13} className="text-gray-400" />
          : <ChevronDown size={13} className="text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2">
          {suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 ${MEAL_CHIP[s.meal_type] ?? 'bg-gray-100 text-gray-600'}`}>
                {s.meal_type}
              </span>
              <div>
                <p className="text-xs font-medium text-gray-800 leading-snug">{s.recipe_name}</p>
                {s.reason && (
                  <p className="text-xs text-gray-400 leading-snug mt-0.5">{s.reason}</p>
                )}
              </div>
            </div>
          ))}

          {error && (
            <p className="text-xs text-red-600 pt-1">{error}</p>
          )}

          {!isAccepted && !isSkipped && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={onAccept}
                disabled={isAccepting}
                className="flex-1 py-1 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {isAccepting ? 'Applying…' : 'Accept Day'}
              </button>
              <button
                onClick={onSkip}
                disabled={isAccepting}
                className="flex-1 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                Skip
              </button>
            </div>
          )}

          {isAccepted && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium pt-1">
              <Check size={11} /> Applied to calendar
            </div>
          )}
        </div>
      )}
    </div>
  );
}
