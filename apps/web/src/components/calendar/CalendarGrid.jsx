import CalendarCell from './CalendarCell';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function buildWeeks(year, month, days) {
  const byDate = {};
  for (const d of days) {
    const key = typeof d.service_date === 'string'
      ? d.service_date.slice(0, 10)
      : new Date(d.service_date).toISOString().slice(0, 10);
    byDate[key] = d;
  }

  // First Monday on or before the 1st of the month
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const startDow = monthStart.getUTCDay(); // 0=Sun
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(monthStart.getUTCDate() - (startDow === 0 ? 6 : startDow - 1));

  // Last Friday on or after the last day of the month
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
      week.push({
        dateStr,
        menuDay: byDate[dateStr] ?? null,
        inMonth: cur.getUTCMonth() === month - 1,
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    cur.setUTCDate(cur.getUTCDate() + 2); // skip Sat + Sun → land on Monday
    weeks.push(week);
  }
  return weeks;
}

export default function CalendarGrid({ year, month, days, selectedDayId, onSelectDay }) {
  const weeks = buildWeeks(year, month, days);

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      {/* Day-of-week header */}
      <div className="grid grid-cols-5 border-b bg-gray-50">
        {DOW.map(h => (
          <div key={h} className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center border-r last:border-r-0">
            {h}
          </div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-5 border-b last:border-b-0">
          {week.map(({ dateStr, menuDay, inMonth }) => (
            <CalendarCell
              key={dateStr}
              dateStr={dateStr}
              menuDay={menuDay}
              inMonth={inMonth}
              isSelected={menuDay?.id === selectedDayId}
              onSelect={menuDay ? () => onSelectDay(menuDay.id) : null}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
