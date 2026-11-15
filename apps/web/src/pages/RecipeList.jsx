import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Sparkles, Tag, CheckSquare, Square, X, Upload, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { recipesApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import AIRecipeWizard from '../components/recipes/AIRecipeWizard';
import ImportRecipeWizard from '../components/recipes/ImportRecipeWizard';

const CATEGORIES = ['', 'HOT_ENTREE', 'COLD_ENTREE', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'];
const PROTEIN_GROUPS = ['', 'CHICKEN', 'FISH', 'BEEF', 'PORK', 'EGG', 'LEGUME', 'OTHER'];
const SEASONS = ['', 'SPRING', 'SUMMER', 'FALL', 'WINTER'];
const VENDORS = ['GFS', 'LOCAL', 'OTHER', 'SYSCO'];

const CAT_LABEL = {
  HOT_ENTREE: 'Hot Entree', COLD_ENTREE: 'Cold Entree', SIDE: 'Side',
  FRUIT: 'Fruit', BREAD: 'Bread', DESSERT: 'Dessert',
};
const CAT_COLOR = {
  HOT_ENTREE: 'bg-orange-100 text-orange-700',
  COLD_ENTREE: 'bg-sky-100 text-sky-700',
  SIDE: 'bg-green-100 text-green-700',
  FRUIT: 'bg-pink-100 text-pink-700',
  BREAD: 'bg-yellow-100 text-yellow-700',
  DESSERT: 'bg-purple-100 text-purple-700',
};

function BulkVendorModal({ count, onConfirm, onClose }) {
  const [vendor, setVendor] = useState('GFS');
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-80 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Set Vendor for {count} Recipe{count !== 1 ? 's' : ''}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          This will set <strong>all ingredients</strong> in the selected recipes to the chosen vendor.
          Useful for bulk-tagging seeded recipes as GFS.
        </p>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">Vendor</label>
          <select
            value={vendor}
            onChange={e => setVendor(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
            <option value="LOCAL">LOCAL (Fresh Produce)</option>
          </select>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => onConfirm(vendor)}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Apply to All
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RecipeList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch]         = useState('');
  const [category, setCategory]     = useState('');
  const [protein, setProtein]       = useState('');
  const [season, setSeason]         = useState('');
  const [showWizard, setShowWizard]         = useState(false);
  const [showImport, setShowImport]         = useState(false);
  const [showPending, setShowPending]       = useState(true);
  const [selected, setSelected]             = useState(new Set()); // recipe IDs
  const [showBulkModal, setShowBulkModal]   = useState(false);
  const [bulkResult, setBulkResult]         = useState(null);

  const canEdit = ['NUTRITION_MANAGER', 'ADMIN'].includes(user?.role);

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => recipesApi.list(),
  });

  const { data: pendingRecipes = [] } = useQuery({
    queryKey: ['recipes-pending'],
    queryFn:  () => recipesApi.pendingReview(),
    enabled:  canEdit,
    staleTime: 60 * 1000,
  });

  const bulkVendorMutation = useMutation({
    mutationFn: ({ ids, vendor }) => recipesApi.bulkSetVendor([...ids], vendor),
    onSuccess: (data) => {
      setBulkResult(`Set ${data.updated} ingredient row${data.updated !== 1 ? 's' : ''} to "${data.vendor}"`);
      setSelected(new Set());
      setShowBulkModal(false);
      setTimeout(() => setBulkResult(null), 4000);
      qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });

  const filtered = recipes.filter(r => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (category && r.category !== category) return false;
    if (protein && r.protein_group !== protein) return false;
    if (season && !r.seasons?.includes(season)) return false;
    return true;
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));

  function toggleAll() {
    if (allFilteredSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(r => next.add(r.id));
        return next;
      });
    }
  }

  function toggleOne(id, e) {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-gray-800">Recipes</h1>
          {selected.size > 0 && (
            <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full font-medium">
              {selected.size} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Bulk vendor button — only when something selected */}
          {canEdit && selected.size > 0 && (
            <>
              <button
                onClick={() => setShowBulkModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-sm rounded-md hover:bg-amber-600 transition-colors"
              >
                <Tag className="w-3.5 h-3.5" />
                Set Vendor ({selected.size})
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                title="Clear selection"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
          {canEdit && (
            <>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Import Recipe
              </button>
              <button
                onClick={() => setShowWizard(true)}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 text-white text-sm rounded-md hover:bg-violet-700 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Create with AI
              </button>
              <button
                onClick={() => navigate('/recipes/new')}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Recipe
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bulk result toast */}
      {bulkResult && (
        <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-200 text-sm text-emerald-700 font-medium flex-shrink-0">
          ✓ {bulkResult}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-2 border-b bg-gray-50 flex-shrink-0 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recipes…"
            className="pl-8 pr-3 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-52"
          />
        </div>
        {[
          ['Category', CATEGORIES, category, setCategory, CAT_LABEL],
          ['Protein', PROTEIN_GROUPS, protein, setProtein, null],
          ['Season', SEASONS, season, setSeason, null],
        ].map(([label, opts, val, setter, labelMap]) => (
          <select
            key={label}
            value={val}
            onChange={e => setter(e.target.value)}
            className="border rounded-md text-sm py-1.5 px-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="">{label}: All</option>
            {opts.filter(Boolean).map(o => (
              <option key={o} value={o}>{labelMap?.[o] ?? o}</option>
            ))}
          </select>
        ))}
        {(search || category || protein || season) && (
          <button
            onClick={() => { setSearch(''); setCategory(''); setProtein(''); setSeason(''); }}
            className="text-xs text-blue-600 hover:underline"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{filtered.length} recipe{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Pending Review section — NM/Admin only */}
      {canEdit && pendingRecipes.length > 0 && (
        <div className="border-b bg-amber-50 flex-shrink-0">
          <button
            onClick={() => setShowPending(p => !p)}
            className="w-full flex items-center justify-between px-6 py-2 text-left hover:bg-amber-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                Awaiting RD Review — {pendingRecipes.length} recipe{pendingRecipes.length !== 1 ? 's' : ''}
              </span>
              <span className="text-xs text-amber-600">
                (inactive until approved)
              </span>
            </div>
            {showPending
              ? <ChevronDown className="w-4 h-4 text-amber-600" />
              : <ChevronRight className="w-4 h-4 text-amber-600" />
            }
          </button>
          {showPending && (
            <div className="px-6 pb-3">
              <table className="w-full text-sm">
                <tbody>
                  {pendingRecipes.map(r => (
                    <tr
                      key={r.id}
                      onClick={() => navigate(`/recipes/${r.id}`)}
                      className="border-b border-amber-200 cursor-pointer hover:bg-amber-100 transition-colors last:border-0"
                    >
                      <td className="py-2 pr-4 font-medium text-gray-800">
                        <span className="flex items-center gap-2">
                          {r.name}
                          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                            r.source === 'AI Generated'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-indigo-100 text-indigo-700'
                          }`}>
                            {r.source === 'AI Generated'
                              ? <><Sparkles className="w-2.5 h-2.5" />AI</>
                              : <><Upload className="w-2.5 h-2.5" />Imported</>
                            }
                          </span>
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-gray-500">
                        <span className={`px-2 py-0.5 rounded-full ${CAT_COLOR[r.category] ?? 'bg-gray-100 text-gray-600'}`}>
                          {CAT_LABEL[r.category] ?? r.category}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-gray-400">{r.source ?? '—'}</td>
                      <td className="py-2 text-xs text-gray-400 text-right">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="p-6 text-sm text-gray-400">Loading…</p>}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <p className="text-sm">No recipes match your filters.</p>
          </div>
        )}

        {filtered.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b">
              <tr>
                {canEdit && (
                  <th className="pl-4 py-2 w-8">
                    <button onClick={toggleAll} className="text-gray-400 hover:text-blue-600 transition-colors">
                      {allFilteredSelected
                        ? <CheckSquare className="w-4 h-4 text-blue-600" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </th>
                )}
                <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Category</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Protein Group</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Servings</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Serving Size</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const isSelected = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/recipes/${r.id}`)}
                    className={`border-b cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-blue-50'
                    }`}
                  >
                    {canEdit && (
                      <td className="pl-4 py-2.5 w-8" onClick={e => toggleOne(r.id, e)}>
                        {isSelected
                          ? <CheckSquare className="w-4 h-4 text-blue-600" />
                          : <Square className="w-4 h-4 text-gray-300 hover:text-gray-500" />
                        }
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      <span className="flex items-center gap-2">
                        {r.name}
                        {r.source === 'AI Generated' && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded-full font-medium flex-shrink-0">
                            <Sparkles className="w-2.5 h-2.5" />AI
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${CAT_COLOR[r.category] ?? 'bg-gray-100 text-gray-600'}`}>
                        {CAT_LABEL[r.category] ?? r.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{r.protein_group ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.base_servings}</td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {r.serving_size_oz ? `${r.serving_size_oz} oz` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showWizard && <AIRecipeWizard onClose={() => setShowWizard(false)} />}
      {showImport && <ImportRecipeWizard onClose={() => setShowImport(false)} />}

      {showBulkModal && (
        <BulkVendorModal
          count={selected.size}
          onConfirm={(vendor) => bulkVendorMutation.mutate({ ids: selected, vendor })}
          onClose={() => setShowBulkModal(false)}
        />
      )}
    </div>
  );
}
