import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Snowflake, Plus, X, BarChart2, List, CheckCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { frozenStockApi, recipesApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const MONTH_FMT = (s) => format(parseISO(s + '-01'), 'MMMM yyyy');

function AddEntryModal({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    recipe_id: '',
    servings: '',
    prepared_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [recipeSearch, setRecipeSearch] = useState('');

  const { data: allRecipes = [] } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => recipesApi.list(),
    staleTime: 5 * 60 * 1000,
  });

  const filtered = allRecipes
    .filter(r => r.is_active && (!recipeSearch || r.name.toLowerCase().includes(recipeSearch.toLowerCase())))
    .slice(0, 12);

  const createMutation = useMutation({
    mutationFn: () => frozenStockApi.create({
      recipe_id:    form.recipe_id,
      servings:     Number(form.servings),
      prepared_date: form.prepared_date,
      notes:        form.notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['frozen-stock'] });
      qc.invalidateQueries({ queryKey: ['frozen-report'] });
      onClose();
    },
  });

  const canSubmit = form.recipe_id && form.servings && Number(form.servings) > 0 && form.prepared_date;
  const selectedRecipe = allRecipes.find(r => r.id === form.recipe_id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Snowflake size={16} className="text-cyan-500" />
            Log Frozen Overrun
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="space-y-4">
          {/* Recipe picker */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Recipe</label>
            {selectedRecipe ? (
              <div className="flex items-center justify-between bg-cyan-50 border border-cyan-200 rounded px-3 py-2">
                <span className="text-sm text-cyan-800 font-medium">{selectedRecipe.name}</span>
                <button onClick={() => setForm(f => ({ ...f, recipe_id: '' }))} className="text-cyan-400 hover:text-red-400">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  placeholder="Search recipes…"
                  value={recipeSearch}
                  onChange={e => setRecipeSearch(e.target.value)}
                  className="w-full text-sm border rounded px-3 py-2 outline-none focus:border-cyan-400 mb-1"
                />
                {recipeSearch && (
                  <div className="border rounded overflow-hidden max-h-40 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <p className="text-xs text-gray-400 px-3 py-2">No results</p>
                    ) : filtered.map(r => (
                      <button
                        key={r.id}
                        onClick={() => { setForm(f => ({ ...f, recipe_id: r.id })); setRecipeSearch(''); }}
                        className="w-full text-left text-sm px-3 py-1.5 hover:bg-cyan-50 flex items-center justify-between"
                      >
                        <span>{r.name}</span>
                        <span className="text-xs text-gray-400">{r.category}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Servings + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Servings</label>
              <input
                type="number"
                min="1"
                value={form.servings}
                onChange={e => setForm(f => ({ ...f, servings: e.target.value }))}
                className="w-full text-sm border rounded px-3 py-2 outline-none focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Prepared Date</label>
              <input
                type="date"
                value={form.prepared_date}
                onChange={e => setForm(f => ({ ...f, prepared_date: e.target.value }))}
                className="w-full text-sm border rounded px-3 py-2 outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <input
              type="text"
              placeholder="Storage location, batch #, etc."
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full text-sm border rounded px-3 py-2 outline-none focus:border-cyan-400"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit || createMutation.isPending}
            className="px-4 py-2 text-sm rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Saving…' : 'Log Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StockLog({ canEdit }) {
  const qc = useQueryClient();
  const [showUsed, setShowUsed] = useState(false);
  const [markingId, setMarkingId] = useState(null);

  const { data: stock = [], isLoading } = useQuery({
    queryKey: ['frozen-stock', showUsed],
    queryFn: () => frozenStockApi.list(!showUsed),
  });

  const markUsed = useMutation({
    mutationFn: (id) => frozenStockApi.update(id, { used_date: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['frozen-stock'] });
      setMarkingId(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id) => frozenStockApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['frozen-stock'] }),
  });

  if (isLoading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={showUsed} onChange={e => setShowUsed(e.target.checked)} className="rounded" />
          Show used entries
        </label>
        <span className="text-xs text-gray-400">{stock.length} {showUsed ? 'total' : 'available'} entr{stock.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {stock.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Snowflake size={32} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm">No frozen stock {showUsed ? '' : 'available'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left pb-2 font-medium">Recipe</th>
                <th className="text-left pb-2 font-medium">Category</th>
                <th className="text-right pb-2 font-medium">Servings</th>
                <th className="text-left pb-2 font-medium pl-4">Prepared</th>
                <th className="text-left pb-2 font-medium">Used</th>
                <th className="text-left pb-2 font-medium">Notes</th>
                {canEdit && <th className="pb-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stock.map(entry => (
                <tr key={entry.id} className={entry.used_date ? 'text-gray-400' : ''}>
                  <td className="py-2 font-medium text-gray-800">{entry.recipe_name}</td>
                  <td className="py-2 text-xs text-gray-500">{entry.recipe_category}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{entry.servings}</td>
                  <td className="py-2 pl-4 text-gray-600">{entry.prepared_date?.slice(0, 10)}</td>
                  <td className="py-2">
                    {entry.used_date
                      ? <span className="flex items-center gap-1 text-green-600"><CheckCircle size={12} />{entry.used_date.slice(0, 10)}</span>
                      : <span className="text-xs text-cyan-600 font-medium">Available</span>}
                  </td>
                  <td className="py-2 text-xs text-gray-500 max-w-xs truncate">{entry.notes || '—'}</td>
                  {canEdit && (
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!entry.used_date && (
                          <button
                            onClick={() => { setMarkingId(entry.id); markUsed.mutate(entry.id); }}
                            disabled={markingId === entry.id}
                            className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
                          >
                            Mark Used
                          </button>
                        )}
                        <button
                          onClick={() => remove.mutate(entry.id)}
                          className="text-gray-300 hover:text-red-400 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OverrunReport() {
  const { data: report = [], isLoading } = useQuery({
    queryKey: ['frozen-report'],
    queryFn: () => frozenStockApi.report(),
  });

  if (isLoading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;

  if (report.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <BarChart2 size={32} className="mx-auto mb-2 text-gray-300" />
        <p className="text-sm">No overrun data yet</p>
      </div>
    );
  }

  // Group by month
  const byMonth = {};
  for (const row of report) {
    if (!byMonth[row.month]) byMonth[row.month] = [];
    byMonth[row.month].push(row);
  }

  return (
    <div className="space-y-6">
      {Object.entries(byMonth).map(([month, rows]) => {
        const totalServings = rows.reduce((sum, r) => sum + r.total_overrun_servings, 0);
        return (
          <div key={month}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">{MONTH_FMT(month)}</h3>
              <span className="text-xs text-gray-400">{totalServings} total servings overrun</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left pb-1 font-medium">Recipe</th>
                  <th className="text-left pb-1 font-medium">Category</th>
                  <th className="text-right pb-1 font-medium">Servings</th>
                  <th className="text-right pb-1 font-medium">Entries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.recipe_id}>
                    <td className="py-1.5 font-medium text-gray-800">{r.recipe_name}</td>
                    <td className="py-1.5 text-xs text-gray-500">{r.recipe_category}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.total_overrun_servings}</td>
                    <td className="py-1.5 text-right text-gray-400">{r.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export default function FrozenStock() {
  const { user } = useAuth();
  const [tab, setTab] = useState('log');
  const [showAdd, setShowAdd] = useState(false);

  const canEdit = ['NUTRITION_MANAGER', 'ADMIN', 'KITCHEN_STAFF'].includes(user?.role);
  const canReport = ['NUTRITION_MANAGER', 'ADMIN'].includes(user?.role);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Snowflake size={20} className="text-cyan-500" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Frozen Stock</h1>
              <p className="text-sm text-gray-500">Track overrun batches frozen for future use</p>
            </div>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 transition-colors"
            >
              <Plus size={15} />
              Log Overrun
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b mb-6">
          <button
            onClick={() => setTab('log')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'log' ? 'border-cyan-500 text-cyan-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <List size={14} />
            Stock Log
          </button>
          {canReport && (
            <button
              onClick={() => setTab('report')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'report' ? 'border-cyan-500 text-cyan-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <BarChart2 size={14} />
              Overrun Report
            </button>
          )}
        </div>

        {/* Tab content */}
        {tab === 'log' && <StockLog canEdit={canEdit} />}
        {tab === 'report' && canReport && <OverrunReport />}
      </div>

      {showAdd && <AddEntryModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
