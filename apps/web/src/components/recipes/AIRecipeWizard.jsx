import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, RefreshCw, ChevronRight, Save } from 'lucide-react';
import { recipesApi } from '../../lib/api';

const CATEGORIES = ['HOT_ENTREE', 'COLD_ENTREE', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'];
const CAT_LABELS  = { HOT_ENTREE: 'Hot Entree', COLD_ENTREE: 'Cold Entree', SIDE: 'Side Dish', FRUIT: 'Fruit', BREAD: 'Bread', DESSERT: 'Dessert' };
const SEASONS     = ['SPRING', 'SUMMER', 'FALL', 'WINTER'];

const EXAMPLE_PROMPTS = [
  'A low-sodium baked chicken entree for summer that serves 100',
  'A vegetable side using butternut squash appropriate for fall',
  'A cold egg salad sandwich option that avoids common allergens',
  'A high-fiber bean-based side dish that pairs well with pork',
];

// ── Step 1: Describe ──────────────────────────────────────────────────────────
function DescribeStep({ onGenerate, isLoading }) {
  const [description, setDescription]   = useState('');
  const [category, setCategory]         = useState('HOT_ENTREE');
  const [season, setSeason]             = useState('');
  const [constraints, setConstraints]   = useState('');

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Describe the recipe you need <span className="text-red-500">*</span>
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          placeholder={EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)]}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
        />
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {EXAMPLE_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => setDescription(p)}
              className="text-[11px] px-2 py-0.5 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-full transition-colors"
            >
              {p.length > 45 ? p.slice(0, 45) + '…' : p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{CAT_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Primary Season</label>
          <select
            value={season}
            onChange={e => setSeason(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">Any season</option>
            {SEASONS.map(s => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Additional constraints <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={constraints}
          onChange={e => setConstraints(e.target.value)}
          placeholder='e.g. "no pork", "uses zucchini from local farm", "must be gluten-free"'
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>

      <button
        onClick={() => onGenerate({ description, category, season: season || undefined, constraints: constraints || undefined })}
        disabled={!description.trim() || isLoading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
      >
        <Sparkles className="w-4 h-4" />
        Generate Recipe with AI
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
        <Sparkles className="w-10 h-10 text-violet-400 animate-pulse" />
      </div>
      <div className="text-center">
        <p className="font-medium text-gray-900">Writing your recipe…</p>
        <p className="text-sm text-gray-500 mt-1">Generating ingredients, instructions, and food safety notes</p>
      </div>
      <div className="flex gap-1 mt-2">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-violet-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Step 3: Preview & edit ────────────────────────────────────────────────────
function PreviewStep({ recipe, onSave, onRegenerate, isSaving }) {
  const [form, setForm] = useState({
    name:            recipe.name ?? '',
    serving_size_oz: recipe.serving_size_oz ?? '',
    serving_utensil: recipe.serving_utensil ?? '',
    cooking_temp_f:  recipe.cooking_temp_f ?? '',
    internal_temp_f: recipe.internal_temp_f ?? '',
    instructions:    recipe.instructions ?? '',
  });

  const f = (field) => (e) => setForm(p => ({ ...p, [field]: e.target.value }));

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className="flex items-center gap-2 p-3 bg-violet-50 border border-violet-200 rounded-lg text-sm text-violet-800">
        <Sparkles className="w-4 h-4 flex-shrink-0" />
        <span>
          <strong>AI Generated</strong> — review all fields before saving. Recipe will be saved as
          inactive and flagged for RD review.
        </span>
      </div>

      {/* Recipe name */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Recipe Name</label>
        <input
          value={form.name}
          onChange={f('name')}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
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
                <th className="text-left px-3 py-2 font-medium text-gray-600">Suggested Vendor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(recipe.ingredients ?? []).map((ing, i) => {
                const v = ing.vendor;
                const vendorColor = !v        ? 'bg-amber-100 text-amber-700'
                                  : v === 'GFS'   ? 'bg-blue-100 text-blue-700'
                                  : v === 'LOCAL' ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-600';
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
          <p className="text-xs text-gray-400 mt-1.5 px-1">
            ✨ AI vendor suggestions — review and adjust in Recipe Editor after saving.
          </p>
        </div>
      </div>

      {/* Instructions */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Production Instructions & CCP Notes
        </label>
        <textarea
          value={form.instructions}
          onChange={f('instructions')}
          rows={8}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave({ ...recipe, ...form })}
          disabled={isSaving || !form.name.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          {isSaving ? 'Saving…' : 'Save for RD Review'}
        </button>
        <button
          onClick={onRegenerate}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try Again
        </button>
      </div>
    </div>
  );
}

// ── Main wizard modal ─────────────────────────────────────────────────────────
export default function AIRecipeWizard({ onClose }) {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const [step, setStep]         = useState('describe'); // 'describe' | 'loading' | 'preview' | 'done'
  const [lastParams, setLastParams] = useState(null);
  const [generated, setGenerated]   = useState(null);
  const [saveError, setSaveError]   = useState('');

  const generateMutation = useMutation({
    mutationFn: (params) => recipesApi.generate(params),
    onMutate: (params) => { setLastParams(params); setStep('loading'); },
    onSuccess: (data) => { setGenerated(data); setStep('preview'); },
    onError: ()  => setStep('describe'),
  });

  const saveMutation = useMutation({
    mutationFn: async (editedRecipe) => {
      // The recipe is already saved in the DB by the generate endpoint.
      // Apply any edits the user made in the preview step via PUT.
      await recipesApi.update(generated.id, {
        name:            editedRecipe.name,
        serving_size_oz: editedRecipe.serving_size_oz || null,
        serving_utensil: editedRecipe.serving_utensil || null,
        cooking_temp_f:  editedRecipe.cooking_temp_f  || null,
        internal_temp_f: editedRecipe.internal_temp_f || null,
        instructions:    editedRecipe.instructions    || null,
      });
      return generated.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
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
            <Sparkles className="w-5 h-5 text-violet-500" />
            <h2 className="text-base font-semibold text-gray-900">AI Recipe Wizard</h2>
            {step === 'preview' && (
              <span className="text-xs px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full font-medium">
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
          {step === 'describe' && (
            <DescribeStep
              onGenerate={(params) => generateMutation.mutate(params)}
              isLoading={generateMutation.isPending}
            />
          )}
          {step === 'loading' && <LoadingStep />}
          {step === 'preview' && generated && (
            <>
              <PreviewStep
                recipe={generated}
                onSave={(edited) => { setSaveError(''); saveMutation.mutate(edited); }}
                onRegenerate={() => { setGenerated(null); generateMutation.mutate(lastParams); }}
                isSaving={saveMutation.isPending}
              />
              {saveError && (
                <p className="mt-2 text-xs text-red-600">{saveError}</p>
              )}
            </>
          )}
          {generateMutation.isError && step === 'describe' && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {generateMutation.error?.response?.data?.error ?? 'Generation failed. Please try again.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
