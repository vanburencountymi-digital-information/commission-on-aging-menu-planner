import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { menusApi } from '../../lib/api';
import NutrientBar from './NutrientBar';

export default function NutritionPanel({ menuId }) {
  const [explainEnabled, setExplainEnabled] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['nutrition', menuId],
    queryFn: () => menusApi.getNutrition(menuId),
    enabled: !!menuId,
  });

  const {
    data: explainData,
    isLoading: explainLoading,
    isError: explainError,
    error: explainErr,
  } = useQuery({
    queryKey: ['nutrition-explain', menuId],
    queryFn: () => menusApi.explainNutrition(menuId),
    enabled: !!menuId && explainEnabled,
    staleTime: 5 * 60 * 1000, // cache for 5 min — Claude is expensive
    retry: false,
  });

  if (!menuId) return null;

  // Build a nutrient → explanation lookup from Claude's response
  const explainByNutrient = {};
  if (explainData?.explanations) {
    for (const exp of explainData.explanations) {
      explainByNutrient[exp.nutrient] = exp;
    }
  }

  const flaggedCount = data?.monthly_compliance?.filter(r => r.status !== 'ok').length ?? 0;
  const hasFlags = flaggedCount > 0;

  return (
    <aside className="w-72 border-l bg-white flex flex-col overflow-hidden flex-shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="text-sm font-semibold text-gray-800">Monthly Averages</h2>
        <Link
          to="/nutrition"
          className="text-xs text-blue-600 hover:underline"
        >
          Full report →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && (
          <p className="text-xs text-gray-400">Loading nutrition data…</p>
        )}

        {!isLoading && data && (
          <>
            <p className="text-xs text-gray-500 mb-3">
              Based on {data.days.filter(d => !d.is_holiday && Object.values(d.totals).some(v => v > 0)).length} active days
            </p>

            {data.monthly_compliance.map(row => (
              <NutrientBar
                key={row.nutrient}
                {...row}
                explanation={explainByNutrient[row.nutrient]?.explanation}
                suggestions={explainByNutrient[row.nutrient]?.suggestions}
              />
            ))}

            {/* Explain gaps button — only shown when there are flagged nutrients */}
            {hasFlags && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                {!explainEnabled && (
                  <button
                    onClick={() => setExplainEnabled(true)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-md bg-violet-50 hover:bg-violet-100 border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors"
                  >
                    <span>✦</span>
                    <span>Explain {flaggedCount} gap{flaggedCount !== 1 ? 's' : ''}</span>
                  </button>
                )}

                {explainEnabled && explainLoading && (
                  <div className="flex items-center justify-center gap-2 py-2 text-xs text-violet-600">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Claude is analyzing…
                  </div>
                )}

                {explainEnabled && explainError && (
                  <p className="text-xs text-red-500 mt-1">
                    {explainErr?.response?.data?.error ?? 'Could not load explanation. Try again.'}
                  </p>
                )}

                {explainEnabled && explainData && !explainLoading && (
                  <p className="text-xs text-violet-500 text-center">
                    ▸ Click any flagged nutrient to see Claude's suggestion
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {!isLoading && !data && (
          <p className="text-xs text-gray-400">No nutrition data available.</p>
        )}
      </div>
    </aside>
  );
}
