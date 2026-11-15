import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { menusApi } from '../../lib/api';
import { X, Download, FileText, AlertTriangle, Package } from 'lucide-react';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function fmt(num) {
  // Format a number: show up to 2 decimals, trim trailing zeros
  const n = Number(num);
  if (n % 1 === 0) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function IngredientRow({ item, idx }) {
  const isUntagged = !item.vendor;
  return (
    <tr className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
      <td className={`px-3 py-1.5 text-sm font-medium ${isUntagged ? 'text-amber-700' : 'text-gray-800'}`}>
        {isUntagged && <AlertTriangle size={11} className="inline mr-1 text-amber-500" />}
        {item.ingredient_name}
      </td>
      <td className="px-3 py-1.5 text-sm text-right tabular-nums text-gray-700">
        {fmt(item.total_quantity)}
      </td>
      <td className="px-3 py-1.5 text-sm text-gray-600">{item.unit}</td>
      <td className="px-3 py-1.5 text-xs text-gray-500">{item.gfs_product_code || '—'}</td>
      <td className="px-3 py-1.5 text-xs text-gray-500">{item.case_size || '—'}</td>
      <td className="px-3 py-1.5 text-xs text-gray-400 max-w-[160px] truncate" title={item.recipes.join(', ')}>
        {item.recipes.join(', ')}
      </td>
    </tr>
  );
}

function IngredientTable({ items, emptyMsg }) {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400 italic py-2 px-3">{emptyMsg}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
            <th className="px-3 py-2">Ingredient</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2">Unit</th>
            <th className="px-3 py-2">Product Code</th>
            <th className="px-3 py-2">Case Size</th>
            <th className="px-3 py-2">Recipes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item, i) => <IngredientRow key={`${item.ingredient_name}-${item.unit}`} item={item} idx={i} />)}
        </tbody>
      </table>
    </div>
  );
}

export default function OrderListPanel({ menuId, menuYear, menuMonth, onClose }) {
  const qc = useQueryClient();
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [defaultServings, setDefaultServings] = useState(100);
  const [pendingServings, setPendingServings] = useState({}); // dayId → value being typed
  const [savingDay, setSavingDay] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['order-list', menuId, selectedWeek, defaultServings],
    queryFn: () => menusApi.getOrderList(menuId, selectedWeek, defaultServings),
    staleTime: 30_000,
  });

  const setServings = useMutation({
    mutationFn: ({ dayId, servings }) => menusApi.setServings(menuId, dayId, servings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['order-list', menuId] }),
  });

  async function saveServings(dayId) {
    const val = parseInt(pendingServings[dayId] ?? '', 10);
    if (!val || val < 1) return;
    setSavingDay(dayId);
    try {
      await setServings.mutateAsync({ dayId, servings: val });
      setPendingServings(prev => { const n = { ...prev }; delete n[dayId]; return n; });
    } finally {
      setSavingDay(null);
    }
  }

  const totalWeeks = data?.total_weeks ?? 1;

  const exportUrl = (format) =>
    menusApi.orderListExportUrl(menuId, selectedWeek, format, defaultServings);

  return (
    <div className="w-[640px] flex-shrink-0 border-l bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-700 text-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <Package size={16} />
          <span className="font-semibold text-sm">Order List</span>
          <span className="text-slate-300 text-sm">— {MONTH_NAMES[menuMonth]} {menuYear}</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-600 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Week selector + default headcount */}
      <div className="px-4 py-3 border-b bg-slate-50 flex-shrink-0 space-y-3">
        {/* Week tabs */}
        <div className="flex gap-1">
          {Array.from({ length: totalWeeks || 5 }, (_, i) => i + 1).map(w => (
            <button
              key={w}
              onClick={() => setSelectedWeek(w)}
              className={`px-3 py-1 text-sm rounded-md font-medium transition-colors ${
                selectedWeek === w
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Week {w}
            </button>
          ))}
        </div>

        {/* Default headcount */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">
            Default servings/day:
          </label>
          <input
            type="number"
            min={1}
            value={defaultServings}
            onChange={e => setDefaultServings(Math.max(1, parseInt(e.target.value || '100', 10)))}
            className="w-24 text-sm border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          <span className="text-xs text-slate-400">(override per-day below)</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            <div className="animate-pulse">Calculating order quantities…</div>
          </div>
        )}

        {isError && (
          <div className="p-4 text-sm text-red-600 bg-red-50 m-4 rounded border border-red-200">
            {error?.response?.data?.error ?? 'Failed to load order list'}
          </div>
        )}

        {data && (
          <>
            {/* Per-day headcount overrides */}
            {data.days?.length > 0 && (
              <div className="px-4 py-3 border-b bg-amber-50">
                <p className="text-xs font-semibold text-amber-800 mb-2">Per-day headcount (overrides default)</p>
                <div className="flex flex-wrap gap-3">
                  {data.days.map(day => {
                    const dateObj = new Date(day.service_date + 'T12:00:00Z');
                    const label = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
                    const pending = pendingServings[day.id];
                    const current = day.estimated_servings;
                    return (
                      <div key={day.id} className="flex flex-col items-center gap-1">
                        <span className="text-xs text-amber-700">{label}</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            className="w-16 text-xs border rounded px-1.5 py-0.5 text-center focus:outline-none focus:ring-1 focus:ring-amber-400"
                            value={pending ?? current}
                            onChange={e => setPendingServings(prev => ({ ...prev, [day.id]: e.target.value }))}
                            onBlur={() => saveServings(day.id)}
                            onKeyDown={e => e.key === 'Enter' && saveServings(day.id)}
                          />
                          {savingDay === day.id && (
                            <span className="text-xs text-amber-600">…</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Summary counts */}
            <div className="px-4 py-2 border-b flex items-center gap-4 text-xs text-gray-600 bg-gray-50">
              <span><span className="font-semibold text-blue-700">{data.gfs_items.length}</span> GFS items</span>
              {data.other_items.length > 0 && (
                <span><span className="font-semibold text-emerald-700">{data.other_items.length}</span> other vendor items</span>
              )}
              {data.untagged_items.length > 0 && (
                <span className="text-amber-700 font-semibold flex items-center gap-1">
                  <AlertTriangle size={11} />
                  {data.untagged_items.length} untagged
                </span>
              )}

              <div className="ml-auto flex items-center gap-2">
                <a
                  href={exportUrl('csv')}
                  download
                  className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs transition-colors"
                >
                  <Download size={11} /> CSV
                </a>
                <a
                  href={exportUrl('pdf')}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 px-2 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded text-xs transition-colors"
                >
                  <FileText size={11} /> PDF
                </a>
              </div>
            </div>

            {/* GFS section */}
            <div className="border-b">
              <div className="px-4 py-2 bg-blue-700">
                <h3 className="text-xs font-bold text-white uppercase tracking-wide">GFS Items ({data.gfs_items.length})</h3>
              </div>
              <IngredientTable items={data.gfs_items} emptyMsg="No GFS-tagged ingredients for this week." />
            </div>

            {/* Other vendors section */}
            {data.other_items.length > 0 && (
              <div className="border-b">
                <div className="px-4 py-2 bg-emerald-700">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wide">Other Vendor Items ({data.other_items.length})</h3>
                </div>
                <IngredientTable items={data.other_items} emptyMsg="No other-vendor items." />
              </div>
            )}

            {/* Untagged section */}
            {data.untagged_items.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-amber-700">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                    ⚠ Untagged — Needs Vendor Assignment ({data.untagged_items.length})
                  </h3>
                </div>
                <div className="bg-amber-50 px-4 py-1 border-b">
                  <p className="text-xs text-amber-700">These ingredients have no vendor assigned. Edit the recipe and set the vendor field for each ingredient.</p>
                </div>
                <IngredientTable items={data.untagged_items} emptyMsg="" />
              </div>
            )}

            {data.gfs_items.length === 0 && data.other_items.length === 0 && data.untagged_items.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <p className="text-sm">No items for this week</p>
                <p className="text-xs mt-1">Recipes with ingredients must be assigned to days in this week.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
