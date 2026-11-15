import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { menusApi } from '../lib/api';
import NutrientBar from '../components/nutrition/NutrientBar';
import MonthNav from '../components/ui/MonthNav';
import StatusBadge from '../components/ui/StatusBadge';

const STATUS_PILL = {
  ok:      'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  low:     'bg-red-100 text-red-700',
  over:    'bg-red-100 text-red-700',
};

function dayOverallStatus(compliance) {
  if (!compliance?.length) return 'ok';
  if (compliance.some(r => r.status === 'low' || r.status === 'over')) return 'low';
  if (compliance.some(r => r.status === 'warning')) return 'warning';
  return 'ok';
}

function DayRow({ day }) {
  const [open, setOpen] = useState(false);
  const hasData = Object.values(day.totals).some(v => v > 0);
  const status = hasData ? dayOverallStatus(day.compliance) : null;

  // Biggest gap = the min-target nutrient furthest below 100% of its target.
  const biggestGap = hasData
    ? ((day.compliance ?? [])
        .filter(r => r.targetType === 'min' && r.pct != null && r.pct < 100)
        .sort((a, b) => a.pct - b.pct)[0] ?? null)
    : null;

  return (
    <div className="border rounded-lg mb-2 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <span className="text-sm font-medium text-gray-800">
            {new Date((typeof day.service_date === 'string' ? day.service_date.slice(0, 10) : new Date(day.service_date).toISOString().slice(0, 10)) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}
          </span>
          {day.is_holiday && (
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Holiday</span>
          )}
        </div>
        {status && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[status]}`}>
            {status === 'ok' ? 'Compliant' : status === 'warning' ? 'Warning' : 'Non-compliant'}
          </span>
        )}
        {!hasData && !day.is_holiday && (
          <span className="text-xs text-gray-400">No items</span>
        )}
      </button>

      {open && hasData && (
        <div className="px-4 pb-3 pt-1 border-t bg-gray-50">
          {day.recipes_without_nutrition?.length > 0 && (
            <p className="text-xs text-amber-600 mb-2">
              Missing nutrition data: {day.recipes_without_nutrition.join(', ')}
            </p>
          )}
          {biggestGap && (
            <p className="text-xs text-amber-600 mb-2">
              Biggest gap: {biggestGap.label} at{' '}
              {Math.round(biggestGap.actual * 10) / 10} {biggestGap.unit} ({biggestGap.pct}% of target)
            </p>
          )}
          {day.compliance.map(row => (
            <NutrientBar key={row.nutrient} {...row} />
          ))}
        </div>
      )}

      {open && !hasData && (
        <div className="px-4 py-2 border-t bg-gray-50">
          <p className="text-xs text-gray-400">No menu items for this day.</p>
        </div>
      )}
    </div>
  );
}

export default function DRIReport() {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const { data: menuList = [], isLoading: listLoading } = useQuery({
    queryKey: ['menus', year, month],
    queryFn: () => menusApi.list(year, month),
  });
  const menuSummary = menuList[0] ?? null;

  const { data: nutrition, isLoading: nutritionLoading, refetch: refetchNutrition } = useQuery({
    queryKey: ['nutrition', menuSummary?.id],
    queryFn: () => menusApi.getNutrition(menuSummary.id),
    enabled: !!menuSummary?.id,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const isLoading = listLoading || nutritionLoading;

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold text-gray-800">DRI Compliance Report</h1>
          <MonthNav year={year} month={month} onPrev={prevMonth} onNext={nextMonth} />
          {menuSummary && <StatusBadge status={menuSummary.status} />}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Day list */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

          {!isLoading && !menuSummary && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <p className="text-lg mb-1">No menu for this month</p>
              <p className="text-sm">Create a menu in the Calendar view first.</p>
            </div>
          )}

          {nutrition && (
            <>
              <p className="text-xs text-gray-500 mb-4">
                OAA Title III-C targets — 1/3 DRI for adults 70+
              </p>
              {nutrition.days.map(day => (
                <DayRow key={day.menu_day_id} day={day} />
              ))}
            </>
          )}
        </div>

        {/* Monthly summary sidebar */}
        {nutrition && (
          <aside className="w-72 border-l bg-white flex flex-col overflow-hidden flex-shrink-0">
            <div className="px-4 py-3 border-b">
              <h2 className="text-sm font-semibold text-gray-800">Monthly Averages</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {nutrition.days.filter(d => !d.is_holiday && Object.values(d.totals).some(v => v > 0)).length} active days
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {nutrition.monthly_compliance.map(row => (
                <NutrientBar key={row.nutrient} {...row} />
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
