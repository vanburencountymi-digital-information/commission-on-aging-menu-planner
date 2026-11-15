import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Upload, X, RefreshCw, ChevronRight, Save, Sparkles, AlertTriangle } from 'lucide-react';
import { recipesApi } from '../../lib/api';

const CATEGORIES = ['HOT_ENTREE', 'COLD_ENTREE', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'];
const CAT_LABELS  = {
  HOT_ENTREE: 'Hot Entree', COLD_ENTREE: 'Cold Entree', SIDE: 'Side Dish',
  FRUIT: 'Fruit', BREAD: 'Bread', DESSERT: 'Dessert',
};

const SOURCE_OPTIONS = [
  'ICN Recipe Box',
  'Mississippi Recipes for Success',
  "USDA What's Cooking?",
  'Other',
];

// ── Step 1: Paste ─────────────────────────────────────────────────────────────
function PasteStep({ onParse, isLoading }) {
  const [text, setText]         = useState('');
  const [sourceName, setSource] = useState('');
  const [category, setCategory] = useState('');

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Paste recipe text <span className="text-red-500">*</span>
        </label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={10}
          placeholder={
            'Paste the full recipe here — ingredient list, quantities, and instructions.\n\n' +
            'Example:\n' +
            'Baked Lemon Herb Chicken\nServes: 50\n\nIngredients:\n' +
            '  - 25 lbs chicken breast\n  - 1/2 cup lemon juice\n  - 2 tbsp dried thyme\n\n' +
            'Instructions:\n1. Preheat oven to 350°F...'
          }
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y font-mono"
        />
        <p className="text-xs text-gray-400 mt-1">
          The assistant will parse ingredients, scale to 100 servings, and format for commercial kitchen production.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
          <input
            value={sourceName}
            onChange={e => setSource(e.target.value)}
            placeholder="e.g. ICN Recipe Box"
            list="import-source-list"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <datalist id="import-source-list">
            {SOURCE_OPTIONS.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Category hint <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Let the assistant decide</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
          </select>
        </div>
      </div>

      <button
        onClick={() => onParse({
          text,
          source_name:   sourceName  || undefined,
          category_hint: category    || undefined,
        })}
        disabled={!text.trim() || isLoading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
      >
        <Sparkles className="w-4 h-4" />
        Parse &amp; Convert with AI
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Step 2: Loading ───────────────────────────────────────────────────────────
function LoadingStep() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="relative">
        <Upload className="w-10 h-10 text-indigo-400 animate-pulse" />
      </div>
      <div className="text-center">
        <p className="font-medium text-gray-900">Converting your recipe…</p>
        <p className="text-sm text-gray-500 mt-1">Parsing ingredients, scaling to 100 servings, adding CCP notes</p>
      </div>
      <div className="flex gap-1 mt-2">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Step 3: Preview & edit ────────────────────────────────────────────────────
function PreviewStep({ recipe, onSave, onReparse, isSaving }) {
  const [form, setForm] = useState({
    name:            recipe.name ?? '',
    serving_size_oz: recipe.serving_size_oz ?? '',
    serving_utensil: recipe.serving_utensil ?? '',
    cooking_temp_f:  recipe.cooking_temp_f ?? '',
    internal_temp_f: recipe.internal_temp_f ?? '',
    instructions:    recipe.instructions ?? '',
  });

  const f = (field) => (e) => setForm(p => ({ ...p, [field]: e.target.value }));
  const sourceLabel = recipe.source?.replace(/^Imported:\s*/, '') ?? 'External';

  const VENDOR_COLORS = {
    GFS:   'bg-blue-100 text-blue-700',
    LOCAL: 'bg-green-100 text-green-700',
  };

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          <strong>Imported from {sourceLabel}</strong> — review all fields. This recipe will be saved as
          inactive and flagged for RD review before it can be used in menus.
        </span>
      </div>

      {/* Recipe name */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Recipe Name</label>
        <input
          value={form.name}
          onChange={f('name')}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Meta row */}
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Serving Size (oz)', 'serving_size_oz', 'number'],
          ['Serving Utensil',   'serving_utensil', 'text'],
          ['Cook Temp (°F)',    'cooking_temp_f',  'number'],
          ['Internal Temp (°F)','internal_temp_f', 'number'],
        ].map(([label, field, type]) => (
          <div key={field}>
            <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
            <input
              type={type}
              value={form[field]}
              onChange={f(field)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        ))}
      </div>

      {/* Ingredients */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Ingredients — {recipe.ingredients?.length ?? 0} items (scaled to 100 servings)
        </label>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Ingredient</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Qty</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Unit</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Vendor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(recipe.ingredients ?? []).map((ing, i) => {
                const v = ing.vendor;
                const vendorColor = VENDOR_COLORS[v] ?? 'bg-gray-100 text-gray-600';
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-800">{ing.ingredient_name}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{ing.quantity_per_100_svgs}</td>
                    <td className="px-3 py-1.5 text-gray-600">{ing.unit}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${vendorColor}`}>
                        {v || 'Untagged'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Instructions */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Production Instructions &amp; CCP Notes
        </label>
        <textarea
          value={form.instructions}
          onChange={f('instructions')}
          rows={8}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave({ ...recipe, ...form })}
          disabled={isSaving || !form.name.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          {isSaving ? 'Saving…' : 'Save for RD Review'}
        </button>
        <button
          onClick={onReparse}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Re-parse
        </button>
      </div>
    </div>
  );
}

// ── Main wizard modal ─────────────────────────────────────────────────────────
export default function ImportRecipeWizard({ onClose }) {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const [step, setStep]             = useState('paste'); // 'paste' | 'loading' | 'preview'
  const [lastParams, setLastParams] = useState(null);
  const [imported, setImported]     = useState(null);
  const [saveError, setSaveError]   = useState('');

  const parseMutation = useMutation({
    mutationFn: (params) => recipesApi.importRecipe(params),
    onMutate:  (params) => { setLastParams(params); setStep('loading'); },
    onSuccess: (data)   => { setImported(data); setStep('preview'); },
    onError:   ()       => setStep('paste'),
  });

  const saveMutation = useMutation({
    mutationFn: async (editedRecipe) => {
      // Recipe already saved by the import endpoint; apply any preview edits via PUT.
      await recipesApi.update(imported.id, {
        name:            editedRecipe.name,
        serving_size_oz: editedRecipe.serving_size_oz || null,
        serving_utensil: editedRecipe.serving_utensil || null,
        cooking_temp_f:  editedRecipe.cooking_temp_f  || null,
        internal_temp_f: editedRecipe.internal_temp_f || null,
        instructions:    editedRecipe.instructions    || null,
      });
      return imported.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipes-pending'] });
      onClose();
      navigate(`/recipes/${id}`);
    },
    onError: (err) => setSaveError(err.response?.data?.error ?? 'Failed to save recipe'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-500" />
            <h2 className="text-base font-semibold text-gray-900">Import External Recipe</h2>
            {step === 'preview' && (
              <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">
                Review &amp; Edit
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'paste' && (
            <PasteStep
              onParse={(params) => parseMutation.mutate(params)}
              isLoading={parseMutation.isPending}
            />
          )}
          {step === 'loading' && <LoadingStep />}
          {step === 'preview' && imported && (
            <>
              <PreviewStep
                recipe={imported}
                onSave={(edited) => { setSaveError(''); saveMutation.mutate(edited); }}
                onReparse={() => { setImported(null); parseMutation.mutate(lastParams); }}
                isSaving={saveMutation.isPending}
              />
              {saveError && (
                <p className="mt-2 text-xs text-red-600">{saveError}</p>
              )}
            </>
          )}
          {parseMutation.isError && step === 'paste' && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {parseMutation.error?.response?.data?.error ?? 'Parsing failed. Please try again.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
