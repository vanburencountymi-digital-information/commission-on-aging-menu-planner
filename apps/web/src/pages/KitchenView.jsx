import { useQuery } from '@tanstack/react-query';
import { menusApi } from '../lib/api';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const MEAL_LABELS = {
  HOT:     'Hot Entree',
  COLD:    'Cold Entree',
  SIDE:    'Side',
  FRUIT:   'Fruit',
  BREAD:   'Bread',
  DESSERT: 'Dessert',
};

const MEAL_COLORS = {
  HOT:     'text-orange-700',
  COLD:    'text-sky-700',
  SIDE:    'text-green-700',
  FRUIT:   'text-pink-700',
  BREAD:   'text-yellow-700',
  DESSERT: 'text-purple-700',
};

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function buildWeeks(year, month, days) {
  const byDate = {};
  for (const d of days) {
    const key = typeof d.service_date === 'string'
      ? d.service_date.slice(0, 10)
      : new Date(d.service_date).toISOString().slice(0, 10);
    byDate[key] = d;
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const startDow = monthStart.getUTCDay();
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(monthStart.getUTCDate() - (startDow === 0 ? 6 : startDow - 1));

  const monthEnd = new Date(Date.UTC(year, month, 0));
  const endDow = monthEnd.getUTCDay();
  const gridEnd = new Date(monthEnd);
  const toFriday = endDow === 0 ? 5 : endDow <= 5 ? 5 - endDow : 6;
  gridEnd.setUTCDate(monthEnd.getUTCDate() + toFriday);

  const weeks = [];
  const cur = new Date(gridStart);
  while (cur <= gridEnd) {
    const week = [];
    for (let i = 0; i < 5; i++) {
      const dateStr = cur.toISOString().slice(0, 10);
      week.push({ dateStr, menuDay: byDate[dateStr] ?? null, inMonth: cur.getUTCMonth() === month - 1 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    cur.setUTCDate(cur.getUTCDate() + 2);
    weeks.push(week);
  }
  return weeks;
}

function KitchenCell({ dateStr, menuDay, inMonth }) {
  const dayNum = parseInt(dateStr.slice(8), 10);

  if (!inMonth || !menuDay) {
    return <div className="border-r last:border-r-0 p-2 min-h-[120px] bg-gray-50 opacity-40" />;
  }

  if (menuDay.is_holiday) {
    return (
      <div className="border-r last:border-r-0 p-2 min-h-[120px] bg-amber-50">
        <p className="text-xs font-semibold text-gray-500 mb-1">{dayNum}</p>
        <p className="text-xs text-amber-700 font-medium">{menuDay.holiday_note || 'Holiday'}</p>
      </div>
    );
  }

  const items = menuDay.items ?? [];
  const grouped = {};
  for (const item of items) {
    (grouped[item.meal_type] ??= []).push(item);
  }

  return (
    <div className="border-r last:border-r-0 p-2 min-h-[120px]">
      <p className="text-xs font-semibold text-gray-500 mb-1.5">{dayNum}</p>
      <div className="space-y-1">
        {Object.entries(grouped).map(([type, typeItems]) => (
          <div key={type}>
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${MEAL_COLORS[type] ?? 'text-gray-500'}`}>
              {MEAL_LABELS[type] ?? type}
            </p>
            {typeItems.map(item => (
              <p key={item.id} className="text-xs text-gray-800 leading-tight">
                {item.recipe_name}
                {item.servings && (
                  <span className="text-gray-400 ml-1">×{item.servings}</span>
                )}
              </p>
            ))}
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-[10px] text-gray-300 italic">No items</p>
        )}
      </div>
    </div>
  );
}

export default function KitchenView() {
  const { data: menu, isLoading, error } = useQuery({
    queryKey: ['kitchen-current'],
    queryFn: menusApi.currentPublished,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading current menu…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium mb-1">No published menu available</p>
          <p className="text-sm">Check back when the current month's menu has been approved and published.</p>
        </div>
      </div>
    );
  }

  const weeks = buildWeeks(menu.year, menu.month, menu.days);
  const pdfUrl = `${import.meta.env.VITE_API_URL ?? ''}/api/menus/${menu.id}/export/pdf`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {MONTH_NAMES[menu.month]} {menu.year} — Meal Menu
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Published menu · read-only</p>
        </div>
        <a
          href={pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Print Menu PDF
        </a>
      </div>

      {/* Calendar */}
      <div className="flex-1 overflow-auto p-6">
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="grid grid-cols-5 border-b bg-gray-50">
            {DOW.map(h => (
              <div key={h} className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center border-r last:border-r-0">
                {h}
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-5 border-b last:border-b-0">
              {week.map(({ dateStr, menuDay, inMonth }) => (
                <KitchenCell key={dateStr} dateStr={dateStr} menuDay={menuDay} inMonth={inMonth} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
