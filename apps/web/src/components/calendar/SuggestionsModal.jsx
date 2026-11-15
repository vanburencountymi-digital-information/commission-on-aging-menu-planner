import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, ArrowRight, Check, X, AlertTriangle } from 'lucide-react';
import { menusApi } from '../../lib/api';

const MEAL_LABELS = {
  HOT: 'Hot Entree', COLD: 'Cold Entree', SIDE: 'Side',
  FRUIT: 'Fruit', BREAD: 'Bread', DESSERT: 'Dessert',
};

export default function SuggestionsModal({ menuId, dayId, conflict, dayItems, onClose, onApplied }) {
  const qc = useQueryClient();
  const [applying, setApplying] = useState(null); // index of suggestion being applied
  const [applied, setApplied]   = useState(new Set());
  const [error, setError]       = useState('');

  const { data: suggestions = [], isLoading, error: fetchError } = useQuery({
    queryKey: ['suggestions', menuId, dayId, conflict.id],
    queryFn: () => menusApi.getSuggestions(menuId, dayId, conflict.id),
    staleTime: Infinity, // don't re-fetch while modal is open
    retry: false,
  });

  async function handleApply(suggestion, idx) {
    setApplying(idx);
    setError('');
    try {
      // Find the item to remove
      const item = dayItems.find(i => i.id === suggestion.replace_item_id);
      if (item) {
        await menusApi.removeItem(menuId, dayId, item.id);
      }
      // Add the replacement
      await menusApi.addItem(menuId, dayId, {
        recipe_id: suggestion.with_recipe_id,
        meal_type: suggestion.meal_type,
      });
      await qc.invalidateQueries({ queryKey: ['menu'] });
      await qc.invalidateQueries({ queryKey: ['nutrition'] });
      setApplied(s => new Set([...s, idx]));
      if (onApplied) onApplied();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to apply suggestion');
    } finally {
      setApplying(null);
    }
  }

  const severityStyle = conflict.severity === 'ERROR'
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-800';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <h2 className="text-base font-semibold text-gray-900">AI Substitution Suggestions</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Conflict context */}
        <div className={`mx-5 mt-4 p-3 rounded-lg border text-xs ${severityStyle}`}>
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">{conflict.severity}: </span>
              {conflict.description}
            </div>
          </div>
        </div>

        {/* Suggestions */}
        <div className="px-5 py-4 space-y-3 min-h-[120px]">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-gray-400">
              <Sparkles className="w-5 h-5 animate-pulse text-violet-400" />
              <p className="text-sm">The assistant is thinking…</p>
            </div>
          )}

          {fetchError && (
            <div className="text-sm text-red-600 py-4 text-center">
              {fetchError.response?.data?.error ?? 'Failed to load suggestions — AI service may not be configured.'}
            </div>
          )}

          {!isLoading && !fetchError && suggestions.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">
              No automatic substitutions available for this conflict.<br />
              Please resolve it manually using the recipe search.
            </p>
          )}

          {suggestions.map((s, i) => {
            const isApplied = applied.has(i);
            const isApplying = applying === i;
            return (
              <div
                key={i}
                className={`rounded-lg border p-3 transition-all ${
                  isApplied ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                }`}
              >
                {/* Swap visualization */}
                <div className="flex items-center gap-2 text-sm mb-1.5">
                  <span className="font-medium text-gray-500 line-through text-xs">{s.replace_recipe_name}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="font-medium text-gray-900">{s.with_recipe_name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{MEAL_LABELS[s.meal_type] ?? s.meal_type}</span>
                </div>
                <p className="text-xs text-gray-500 italic mb-2">{s.reason}</p>

                {isApplied ? (
                  <div className="flex items-center gap-1 text-xs text-green-700 font-medium">
                    <Check className="w-3.5 h-3.5" /> Applied
                  </div>
                ) : (
                  <button
                    onClick={() => handleApply(s, i)}
                    disabled={isApplying || applying !== null}
                    className="flex items-center gap-1.5 px-3 py-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    {isApplying ? 'Applying…' : 'Apply this swap'}
                  </button>
                )}
              </div>
            );
          })}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-5 pb-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
