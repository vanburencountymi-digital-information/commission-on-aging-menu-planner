import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Search, Plus, Sparkles, Snowflake } from 'lucide-react';
import { format } from 'date-fns';
import { menusApi, recipesApi } from '../../lib/api';
import RecipeChip from './RecipeChip';
import SuggestionsModal from './SuggestionsModal';

const LOCKED = ['SUBMITTED', 'APPROVED', 'PUBLISHED'];

// Slot config — drives all meal sections in order
// category: null = any active recipe (used for FROZEN — could be any entree)
const SLOTS = [
  { type: 'HOT',     label: 'HOT Entree',       category: 'HOT_ENTREE',  bg: 'bg-orange-50 border-orange-100' },
  { type: 'COLD',    label: 'Cold Entree',       category: 'COLD_ENTREE', bg: 'bg-sky-50 border-sky-100'       },
  { type: 'FROZEN',  label: 'Frozen Option',     category: null,          bg: 'bg-cyan-50 border-cyan-100'     },
  { type: 'SIDE',    label: 'Side Dish',         category: 'SIDE',        bg: 'bg-green-50 border-green-100'   },
  { type: 'FRUIT',   label: 'Fruit',             category: 'FRUIT',       bg: 'bg-pink-50 border-pink-100'     },
  { type: 'BREAD',   label: 'Bread',             category: 'BREAD',       bg: 'bg-yellow-50 border-yellow-100' },
  { type: 'DESSERT', label: 'Dessert',           category: 'DESSERT',     bg: 'bg-purple-50 border-purple-100' },
];

const INITIAL_SEARCH = Object.fromEntries(SLOTS.map(s => [s.type, '']));

function toDateStr(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

export default function DayEditor({ menuId, menuDay, menuStatus, onClose }) {
  const [search, setSearch] = useState(INITIAL_SEARCH);
  const [activeSlot, setActiveSlot] = useState(null);
  const [suggestConflict, setSuggestConflict] = useState(null); // conflict object | null
  const qc = useQueryClient();

  const { data: allRecipes = [] } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => recipesApi.list(),
    staleTime: 5 * 60 * 1000,
  });

  const isLocked = LOCKED.includes(menuStatus);

  const addItem = useMutation({
    mutationFn: ({ recipeId, mealType }) =>
      menusApi.addItem(menuId, menuDay.id, { recipe_id: recipeId, meal_type: mealType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu'] });
      qc.invalidateQueries({ queryKey: ['nutrition'] });
      qc.invalidateQueries({ queryKey: ['day-nutrition'] });
      setSearch(INITIAL_SEARCH);
      setActiveSlot(null);
    },
  });

  const removeItem = useMutation({
    mutationFn: (itemId) => menusApi.removeItem(menuId, menuDay.id, itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu'] });
      qc.invalidateQueries({ queryKey: ['nutrition'] });
      qc.invalidateQueries({ queryKey: ['day-nutrition'] });
    },
  });

  const dateStr = toDateStr(menuDay.service_date);
  const conflicts = menuDay.conflicts ?? [];

  // Build a map of recipeId → service_date for any recipe used within ±21 days
  // of this day (excluding the current day itself). Used to warn in the dropdown.
  const recentlyUsed = useMemo(() => {
    const menuData = qc.getQueryData(['menu', menuId]);
    const allDays = menuData?.days ?? [];
    const d = new Date(dateStr + 'T00:00:00Z');
    const winStart = new Date(d); winStart.setUTCDate(d.getUTCDate() - 21);
    const winEnd   = new Date(d); winEnd.setUTCDate(d.getUTCDate() + 21);
    const map = new Map(); // recipeId → nearest used dateStr
    for (const day of allDays) {
      if (day.id === menuDay.id) continue;
      const ds = toDateStr(day.service_date);
      const dayDate = new Date(ds + 'T00:00:00Z');
      if (dayDate >= winStart && dayDate <= winEnd) {
        for (const item of day.items ?? []) {
          if (!map.has(item.recipe_id)) map.set(item.recipe_id, ds);
        }
      }
    }
    return map;
  }, [qc, menuId, menuDay.id, dateStr]);

  function suggestions(slotCategory, slotType) {
    const q = search[slotType].toLowerCase().trim();
    return allRecipes
      // null category = no filter (FROZEN slot accepts any recipe)
      .filter(r => (slotCategory === null || r.category === slotCategory) && (!q || r.name.toLowerCase().includes(q)))
      .slice(0, q ? 7 : 15);
  }

  const serviceDate = new Date(dateStr + 'T00:00:00Z');
  const itemsByType = Object.fromEntries(
    SLOTS.map(s => [s.type, (menuDay.items ?? []).filter(i => i.meal_type === s.type)])
  );

  return (
    // Root is the TOP section of the split right panel — the wrapper in
    // MenuCalendar provides width, border and shadow; DailyNutritionSummary
    // sits below as the bottom section.
    <div className="flex-1 min-h-0 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b bg-gray-50">
        <div>
          <p className="font-semibold text-gray-900">{format(serviceDate, 'EEEE, MMMM d')}</p>
          {menuDay.is_holiday && (
            <span className="inline-block text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded mt-1">
              Holiday{menuDay.holiday_note ? ` — ${menuDay.holiday_note}` : ''}
            </span>
          )}
          {isLocked && (
            <span className="inline-block text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded mt-1 ml-1">
              {menuStatus} — read only
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Conflicts</p>
            <div className="space-y-1">
              {conflicts.map(c => (
                <div
                  key={c.id}
                  className={`text-xs p-2 rounded border ${
                    c.severity === 'ERROR'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-amber-50 border-amber-200 text-amber-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span><span className="font-semibold">{c.severity}:</span> {c.description}</span>
                    {!isLocked && (
                      <button
                        onClick={() => setSuggestConflict(c)}
                        className="flex items-center gap-1 flex-shrink-0 px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors font-medium"
                      >
                        <Sparkles size={10} />
                        Fix
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All meal slots */}
        {SLOTS.map(slot => (
          <SlotSection
            key={slot.type}
            label={slot.label}
            type={slot.type}
            bg={slot.bg}
            items={itemsByType[slot.type]}
            isLocked={isLocked}
            searchText={search[slot.type]}
            onSearchChange={q => setSearch(s => ({ ...s, [slot.type]: q }))}
            suggestions={suggestions(slot.category, slot.type)}
            recentlyUsed={recentlyUsed}
            onAdd={r => addItem.mutate({ recipeId: r.id, mealType: slot.type })}
            onRemove={id => removeItem.mutate(id)}
            isActive={activeSlot === slot.type}
            onFocus={() => setActiveSlot(slot.type)}
            onBlur={() => setTimeout(() => setActiveSlot(null), 150)}
          />
        ))}

        {/* Notes */}
        {menuDay.notes && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Notes</p>
            <p className="text-sm text-gray-600">{menuDay.notes}</p>
          </div>
        )}

        {/* Post-service actuals + overrun planning */}
        <ActualsSection menuId={menuId} menuDay={menuDay} />
      </div>

      {/* AI Suggestions Modal */}
      {suggestConflict && (
        <SuggestionsModal
          menuId={menuId}
          dayId={menuDay.id}
          conflict={suggestConflict}
          dayItems={menuDay.items ?? []}
          onClose={() => setSuggestConflict(null)}
          onApplied={() => setSuggestConflict(null)}
        />
      )}
    </div>
  );
}

function ActualsSection({ menuId, menuDay }) {
  const [form, setForm] = useState({
    planned_overrun_pct: String(menuDay.planned_overrun_pct ?? 0),
    actual_prepared:     String(menuDay.actual_prepared ?? ''),
    actual_served:       String(menuDay.actual_served ?? ''),
  });
  const [saved, setSaved] = useState(false);
  const qc = useQueryClient();

  const actualsMutation = useMutation({
    mutationFn: () => menusApi.updateActuals(menuId, menuDay.id, {
      planned_overrun_pct: form.planned_overrun_pct !== '' ? Number(form.planned_overrun_pct) : null,
      actual_prepared:     form.actual_prepared !== '' ? Number(form.actual_prepared) : null,
      actual_served:       form.actual_served !== '' ? Number(form.actual_served) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const overrun = (form.actual_prepared !== '' && form.actual_served !== '')
    ? Number(form.actual_prepared) - Number(form.actual_served)
    : null;

  function field(label, key, placeholder, suffix) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-gray-500">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            step={key === 'planned_overrun_pct' ? '0.5' : '1'}
            placeholder={placeholder}
            value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            className="w-20 text-xs border rounded px-2 py-1 outline-none focus:border-cyan-400 bg-white"
          />
          {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cyan-100 bg-cyan-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
        <Snowflake size={11} className="text-cyan-400" />
        Production Counts
      </p>
      <div className="flex flex-wrap gap-4 mb-3">
        {field('Planned Overrun', 'planned_overrun_pct', '0', '%')}
        {field('Actual Prepared', 'actual_prepared', '—', 'srv')}
        {field('Actual Served', 'actual_served', '—', 'srv')}
      </div>
      {overrun !== null && (
        <p className={`text-xs mb-2 ${overrun > 0 ? 'text-cyan-700' : 'text-gray-500'}`}>
          {overrun > 0
            ? `${overrun} serving${overrun !== 1 ? 's' : ''} available to freeze`
            : overrun === 0 ? 'No overrun' : `${Math.abs(overrun)} serving deficit`}
        </p>
      )}
      <button
        onClick={() => actualsMutation.mutate()}
        disabled={actualsMutation.isPending}
        className="text-xs px-3 py-1 rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50 transition-colors"
      >
        {saved ? '✓ Saved' : actualsMutation.isPending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function SlotSection({ label, type, bg, items, isLocked, searchText, onSearchChange, suggestions, recentlyUsed, onAdd, onRemove, isActive, onFocus, onBlur }) {
  return (
    <div className={`rounded-lg border p-3 ${bg}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{label}</p>

      <div className="space-y-1 mb-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-1">
            <RecipeChip name={item.recipe_name} type={type} />
            {!isLocked && (
              <button
                onClick={() => onRemove(item.id)}
                className="text-gray-300 hover:text-red-400 transition-colors text-sm leading-none"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {!isLocked && (
        <div className="relative">
          <div className="flex items-center gap-1.5 bg-white border rounded px-2 py-1.5">
            <Search size={11} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Click to browse or type to search…"
              value={searchText}
              onChange={e => onSearchChange(e.target.value)}
              onFocus={onFocus}
              onBlur={onBlur}
              className="flex-1 text-xs outline-none bg-transparent placeholder-gray-400"
            />
          </div>

          {isActive && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 bg-white border rounded-md shadow-lg mt-0.5 overflow-hidden max-h-56 overflow-y-auto">
              {suggestions.map(r => {
                const usedOn = recentlyUsed?.get(r.id);
                return (
                  <button
                    key={r.id}
                    onMouseDown={() => onAdd(r)}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 ${
                      usedOn ? 'text-gray-400 hover:bg-amber-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Plus size={10} className="text-gray-400 flex-shrink-0" />
                      {r.name}
                    </span>
                    {usedOn && (
                      <span className="text-amber-500 text-xs flex-shrink-0">⚠ used {usedOn}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
