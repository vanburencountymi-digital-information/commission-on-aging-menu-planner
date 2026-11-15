import { useQuery } from '@tanstack/react-query';
import { menusApi } from '../../lib/api';
import NutrientBar from './NutrientBar';

// Per-day DRI breakdown shown beneath the DayEditor. Refreshes automatically
// whenever an item is added or removed (DayEditor invalidates ['day-nutrition']).
export default function DailyNutritionSummary({ menuId, dayId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['day-nutrition', dayId],
    queryFn: () => menusApi.getDayNutrition(menuId, dayId),
    enabled: !!menuId && !!dayId,
  });

  // Biggest gap = the min-target nutrient furthest below 100% of its target.
  const biggestGap = (data?.compliance ?? [])
    .filter(r => r.targetType === 'min' && r.pct != null && r.pct < 100)
    .sort((a, b) => a.pct - b.pct)[0] ?? null;

  return (
    <div className="flex-shrink-0 border-t bg-white flex flex-col max-h-[42%] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Daily Nutrition
        </h3>
        {data && (
          <span className="text-xs text-gray-400">
            {data.items_count} item{data.items_count !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && <p className="text-xs text-gray-400">Loading…</p>}

        {data && data.items_count === 0 && (
          <p className="text-xs text-gray-400">
            No items yet — add recipes above to see this day's nutrition.
          </p>
        )}

        {data && data.items_count > 0 && (
          <>
            {data.unlinked_count > 0 && (
              <p className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1 mb-2">
                {data.unlinked_count} recipe{data.unlinked_count !== 1 ? 's' : ''} missing
                nutrition data — totals below are partial.
              </p>
            )}

            {biggestGap && (
              <p className="text-xs text-amber-600 mb-2">
                Biggest gap: {biggestGap.label} at{' '}
                {Math.round(biggestGap.actual * 10) / 10} {biggestGap.unit} ({biggestGap.pct}% of target)
              </p>
            )}

            {data.compliance.map(row => (
              <NutrientBar
                key={row.nutrient}
                {...row}
                contributor={data.top_contributors?.[row.nutrient]}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
