import { Snowflake } from 'lucide-react';
import RecipeChip from './RecipeChip';
import ConflictBadge from './ConflictBadge';

export default function CalendarCell({ dateStr, menuDay, inMonth, isSelected, onSelect }) {
  const dayNum = parseInt(dateStr.slice(8), 10);
  const hotItems  = menuDay?.items?.filter(i => i.meal_type === 'HOT')  ?? [];
  const coldItems = menuDay?.items?.filter(i => i.meal_type === 'COLD') ?? [];
  const conflicts = menuDay?.conflicts ?? [];

  // Show snowflake when there are frozen servings available (prepared > served)
  const hasFrozen = menuDay?.actual_prepared != null &&
                    menuDay?.actual_served != null &&
                    menuDay.actual_prepared > menuDay.actual_served;

  return (
    <div
      onClick={menuDay ? onSelect : undefined}
      className={[
        'min-h-32 p-2 border-r last:border-r-0 transition-colors',
        inMonth ? 'bg-white' : 'bg-gray-50',
        menuDay ? 'cursor-pointer hover:bg-blue-50' : 'cursor-default',
        isSelected ? 'ring-2 ring-inset ring-blue-500 bg-blue-50' : '',
      ].join(' ')}
    >
      {/* Date row */}
      <div className="flex items-start justify-between mb-1">
        <span className={`text-sm font-medium ${inMonth ? 'text-gray-900' : 'text-gray-300'}`}>
          {dayNum}
        </span>
        <div className="flex items-center gap-1">
          {menuDay?.is_holiday && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1 rounded leading-tight">H</span>
          )}
          {hasFrozen && (
            <span title={`${menuDay.actual_prepared - menuDay.actual_served} frozen servings available`}>
              <Snowflake size={12} className="text-cyan-400" />
            </span>
          )}
          <ConflictBadge conflicts={conflicts} />
        </div>
      </div>

      {/* Items */}
      {menuDay && (
        <div className="space-y-0.5">
          {hotItems.map(item => (
            <RecipeChip key={item.id} name={item.recipe_name} type="HOT" />
          ))}
          {coldItems.map(item => (
            <RecipeChip key={item.id} name={item.recipe_name} type="COLD" />
          ))}
          {hotItems.length === 0 && coldItems.length === 0 && (
            <span className="text-xs text-gray-300">+ add items</span>
          )}
        </div>
      )}
    </div>
  );
}
