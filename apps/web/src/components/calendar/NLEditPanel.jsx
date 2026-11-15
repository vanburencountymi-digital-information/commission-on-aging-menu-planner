import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Send, Check, X, CheckCheck, XCircle } from 'lucide-react';
import { menusApi } from '../../lib/api';

const ACTION_COLORS = {
  add:     'bg-green-50 border-green-200 text-green-800',
  remove:  'bg-red-50 border-red-200 text-red-800',
  replace: 'bg-amber-50 border-amber-200 text-amber-800',
};

const ACTION_LABELS = {
  add:     'Add',
  remove:  'Remove',
  replace: 'Replace',
};

const MEAL_LABELS = {
  HOT: 'Hot Entree', COLD: 'Cold Entree', SIDE: 'Side',
  FRUIT: 'Fruit', BREAD: 'Bread', DESSERT: 'Dessert',
};

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export default function NLEditPanel({ menuId, menuDays, onChangesApplied, embedded = false }) {
  const qc = useQueryClient();
  const [instruction, setInstruction] = useState('');
  const [diff, setDiff] = useState(null);        // { summary, changes }
  const [accepted, setAccepted] = useState({}); // { [idx]: true|false }
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const editMutation = useMutation({
    mutationFn: (instr) => menusApi.edit(menuId, instr),
    onSuccess: (data) => {
      setDiff(data);
      // Default all changes to accepted
      const init = {};
      data.changes.forEach((_, i) => { init[i] = true; });
      setAccepted(init);
      setInstruction('');
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!instruction.trim() || editMutation.isPending) return;
    setDiff(null);
    setApplyError('');
    editMutation.mutate(instruction.trim());
  }

  async function applyChanges() {
    const toApply = diff.changes.filter((_, i) => accepted[i] !== false);
    if (!toApply.length) { setDiff(null); return; }

    setApplying(true);
    setApplyError('');
    try {
      // Apply each accepted change sequentially using existing item endpoints
      for (const change of toApply) {
        const day = menuDays.find(d => {
          const date = typeof d.service_date === 'string'
            ? d.service_date.slice(0, 10)
            : new Date(d.service_date).toISOString().slice(0, 10);
          return date === change.date;
        });
        if (!day) continue;

        if (change.action === 'remove' || change.action === 'replace') {
          // Find the item to remove
          const item = day.items?.find(it =>
            it.recipe_id === change.remove_recipe_id && it.meal_type === change.meal_type
          ) ?? day.items?.find(it => it.meal_type === change.meal_type);
          if (item) {
            await menusApi.removeItem(menuId, day.id, item.id);
          }
        }
        if (change.action === 'add' || change.action === 'replace') {
          if (change.recipe_id) {
            await menusApi.addItem(menuId, day.id, {
              recipe_id: change.recipe_id,
              meal_type: change.meal_type,
            });
          }
        }
      }
      await qc.invalidateQueries({ queryKey: ['menu', menuId] });
      await qc.invalidateQueries({ queryKey: ['nutrition', menuId] });
      setDiff(null);
      if (onChangesApplied) onChangesApplied(toApply.length);
    } catch (err) {
      setApplyError(err.response?.data?.error ?? 'Failed to apply some changes — please review manually.');
    } finally {
      setApplying(false);
    }
  }

  const acceptedCount = diff ? diff.changes.filter((_, i) => accepted[i] !== false).length : 0;

  return (
    <div className={embedded ? 'flex flex-col flex-1 min-h-0 overflow-hidden' : 'border-t bg-white flex-shrink-0'}>
      {/* Diff review panel */}
      {diff && (
        <div className={`border-b px-4 py-3 overflow-y-auto ${embedded ? 'flex-1 min-h-0' : 'max-h-72'}`}>
          {/* Summary */}
          <div className="flex items-start gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700">{diff.summary}</p>
          </div>

          {diff.changes.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No changes proposed.</p>
          ) : (
            <>
              {/* Accept/Reject all */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-500">{acceptedCount} of {diff.changes.length} selected</span>
                <button
                  onClick={() => {
                    const all = {};
                    diff.changes.forEach((_, i) => { all[i] = true; });
                    setAccepted(all);
                  }}
                  className="text-xs text-green-700 hover:underline flex items-center gap-1"
                >
                  <CheckCheck className="w-3 h-3" /> Accept all
                </button>
                <button
                  onClick={() => {
                    const none = {};
                    diff.changes.forEach((_, i) => { none[i] = false; });
                    setAccepted(none);
                  }}
                  className="text-xs text-red-600 hover:underline flex items-center gap-1"
                >
                  <XCircle className="w-3 h-3" /> Reject all
                </button>
              </div>

              {/* Individual changes */}
              <div className="space-y-1.5">
                {diff.changes.map((change, i) => {
                  const isAccepted = accepted[i] !== false;
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-2 p-2 rounded-lg border text-xs transition-opacity ${
                        ACTION_COLORS[change.action]
                      } ${!isAccepted ? 'opacity-40' : ''}`}
                    >
                      <button
                        onClick={() => setAccepted(a => ({ ...a, [i]: !isAccepted }))}
                        className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                          isAccepted
                            ? 'bg-green-600 border-green-600 text-white'
                            : 'bg-white border-gray-300'
                        }`}
                      >
                        {isAccepted && <Check className="w-2.5 h-2.5" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 font-medium">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            change.action === 'add' ? 'bg-green-200 text-green-800' :
                            change.action === 'remove' ? 'bg-red-200 text-red-800' :
                            'bg-amber-200 text-amber-800'
                          }`}>
                            {ACTION_LABELS[change.action]}
                          </span>
                          <span>{formatDate(change.date)}</span>
                          <span className="text-gray-500">·</span>
                          <span>{MEAL_LABELS[change.meal_type] ?? change.meal_type}</span>
                        </div>
                        {change.recipe_name && (
                          <p className="mt-0.5 text-gray-700">→ {change.recipe_name}</p>
                        )}
                        <p className="mt-0.5 text-gray-500 italic">{change.reason}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {applyError && (
                <p className="text-xs text-red-600 mt-2">{applyError}</p>
              )}

              {/* Apply / Discard */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={applyChanges}
                  disabled={applying || acceptedCount === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  {applying ? 'Applying…' : `Apply ${acceptedCount} change${acceptedCount !== 1 ? 's' : ''}`}
                </button>
                <button
                  onClick={() => setDiff(null)}
                  disabled={applying}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-medium rounded-lg transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Discard
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Chat input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-3">
        <div className="flex items-center gap-2 flex-1 border border-gray-300 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-violet-400 focus-within:border-violet-400 bg-white transition-all">
          <Sparkles className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <input
            type="text"
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder='e.g. "Swap all fish to chicken this week — salmon is backordered"'
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 focus:outline-none bg-transparent"
            disabled={editMutation.isPending}
          />
        </div>
        <button
          type="submit"
          disabled={!instruction.trim() || editMutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors flex-shrink-0"
        >
          {editMutation.isPending ? (
            <span className="text-xs">Thinking…</span>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ask AI</span>
            </>
          )}
        </button>
      </form>

      {editMutation.isError && (
        <p className="px-4 pb-2 text-xs text-red-500">
          {editMutation.error?.response?.data?.error ?? 'Failed to process instruction'}
        </p>
      )}
    </div>
  );
}
