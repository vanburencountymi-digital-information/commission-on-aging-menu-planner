import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Search, ArrowLeft, Wand2, Sparkles } from 'lucide-react';
import { recipesApi } from '../lib/api';
import USDASearchModal from '../components/recipes/USDASearchModal';

const CATEGORIES = ['HOT_ENTREE', 'COLD_ENTREE', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'];
const PROTEIN_GROUPS = ['CHICKEN', 'FISH', 'BEEF', 'PORK', 'EGG', 'LEGUME', 'OTHER'];
const SEASONS_LIST = ['SPRING', 'SUMMER', 'FALL', 'WINTER'];
const UNITS = ['g', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'each', 'quart', 'gallon', 'ml', 'liter'];

const VENDORS = ['GFS', 'OTHER', 'LOCAL', 'SYSCO'];
const EMPTY_ING = () => ({
  ingredient_name: '', quantity_per_100_svgs: '', unit: 'oz',
  usda_fdc_id: null, _usdaDesc: '', _usdaReason: null,
  vendor: 'GFS', gfs_product_code: '', case_size: '', order_unit: '',
});

function Field({ label, children, required }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const INPUT_CLS = 'w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

export default function RecipeEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = !id;

  // Load existing recipe data for edit mode
  const { data: existing, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => recipesApi.get(id),
    enabled: !isNew,
  });

  // Form state — populated from existing recipe once loaded
  const [form, setForm] = useState(null);
  const [ingredients, setIngredients] = useState(null);
  const [usdaModalIdx, setUsdaModalIdx] = useState(null);
  const [errors, setErrors] = useState({});
  const [autoLinking, setAutoLinking] = useState(false);
  const [autoLinkResult, setAutoLinkResult] = useState(null);

  async function handleAutoLink() {
    const unlinked = ingredients.filter(i => i.ingredient_name.trim() && !i.usda_fdc_id);
    if (unlinked.length === 0) { setAutoLinkResult('All ingredients already linked.'); return; }
    setAutoLinking(true);
    setAutoLinkResult(null);
    let linked = 0, aiLinked = 0, notFound = 0;
    const updated = [...ingredients];
    for (let i = 0; i < updated.length; i++) {
      const ing = updated[i];
      if (!ing.ingredient_name.trim() || ing.usda_fdc_id) continue;
      try {
        const result = await recipesApi.usdaAiLink(
          ing.ingredient_name.trim(),
          form?.name ?? '',
          form?.category ?? '',
        );
        if (result?.fdcId) {
          updated[i] = {
            ...ing,
            usda_fdc_id:  result.fdcId,
            _usdaDesc:    result.description ?? '',
            _usdaReason:  result.reason ?? null,
          };
          linked++;
          if (result.reason) aiLinked++;
        } else {
          notFound++;
        }
      } catch {
        notFound++;
      }
      // Small delay to avoid hammering USDA + Claude APIs
      await new Promise(r => setTimeout(r, 200));
    }
    setIngredients(updated);
    setAutoLinking(false);
    setAutoLinkResult(
      `Linked ${linked} ingredient${linked !== 1 ? 's' : ''}` +
      (aiLinked > 0 ? ` (${aiLinked} AI-selected)` : '') +
      (notFound > 0 ? `, ${notFound} not found` : '') +
      '.'
    );
  }

  // Initialise form once existing recipe loads
  if (!isNew && existing && form === null) {
    setForm({
      name: existing.name,
      category: existing.category,
      base_servings: existing.base_servings,
      serving_size_oz: existing.serving_size_oz ?? '',
      serving_utensil: existing.serving_utensil ?? '',
      cooking_temp_f: existing.cooking_temp_f ?? '',
      internal_temp_f: existing.internal_temp_f ?? '',
      instructions: existing.instructions ?? '',
      protein_group: existing.protein_group ?? '',
      seasons: existing.seasons ?? [],
      source: existing.source ?? '',
      is_active: existing.is_active ?? true,
    });
    setIngredients((existing.ingredients ?? []).map(ing => ({
      ingredient_name:       ing.ingredient_name,
      quantity_per_100_svgs: ing.quantity_per_100_svgs,
      unit:                  ing.unit,
      usda_fdc_id:           ing.usda_fdc_id           ?? null,
      _usdaDesc:             '',
      _usdaReason:           null,
      vendor:                ing.vendor                ?? 'GFS',
      gfs_product_code:      ing.gfs_product_code      ?? '',
      case_size:             ing.case_size             ?? '',
      order_unit:            ing.order_unit            ?? '',
    })));
  }

  if (isNew && form === null) {
    setForm({
      name: '', category: 'HOT_ENTREE', base_servings: 100,
      serving_size_oz: '', serving_utensil: '', cooking_temp_f: '',
      internal_temp_f: '', instructions: '', protein_group: '',
      seasons: [], source: '', is_active: true,
    });
    setIngredients([EMPTY_ING()]);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        base_servings: Number(form.base_servings) || 100,
        serving_size_oz:  form.serving_size_oz  !== '' ? Number(form.serving_size_oz)  : null,
        cooking_temp_f:   form.cooking_temp_f   !== '' ? Number(form.cooking_temp_f)   : null,
        internal_temp_f:  form.internal_temp_f  !== '' ? Number(form.internal_temp_f)  : null,
        protein_group: form.protein_group || null,
        source:        form.source || null,
      };

      let recipe;
      if (isNew) {
        recipe = await recipesApi.create(payload);
      } else {
        recipe = await recipesApi.update(id, payload);
      }

      const ingPayload = ingredients
        .filter(i => i.ingredient_name.trim())
        .map(i => ({
          ingredient_name:       i.ingredient_name.trim(),
          quantity_per_100_svgs: Number(i.quantity_per_100_svgs) || 0,
          unit:                  i.unit,
          usda_fdc_id:           i.usda_fdc_id           ?? null,
          vendor:                i.vendor                || 'GFS',
          gfs_product_code:      i.gfs_product_code?.trim() || null,
          case_size:             i.case_size?.trim()     || null,
          order_unit:            i.order_unit?.trim()    || null,
        }));
      await recipesApi.setIngredients(recipe.id, ingPayload);

      // Auto-recalculate nutrition profile if any ingredients have USDA FDC IDs
      const hasUsda = ingPayload.some(i => i.usda_fdc_id);
      if (hasUsda) {
        try { await recipesApi.recalculate(recipe.id); } catch { /* non-fatal */ }
      }

      return recipe;
    },
    onSuccess: (recipe) => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipe', recipe.id] });
      navigate(`/recipes/${recipe.id}`);
    },
  });

  function handleSave() {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Required';
    if (!form.category)     errs.category = 'Required';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    saveMutation.mutate();
  }

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }));
  }

  function toggleSeason(s) {
    setForm(f => ({
      ...f,
      seasons: f.seasons.includes(s) ? f.seasons.filter(x => x !== s) : [...f.seasons, s],
    }));
  }

  function setIng(i, key, val) {
    setIngredients(list => list.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }

  function addIng() { setIngredients(list => [...list, EMPTY_ING()]); }
  function removeIng(i) { setIngredients(list => list.filter((_, idx) => idx !== i)); }

  function handleUsdaSelect(food) {
    setIngredients(list => list.map((r, idx) =>
      idx === usdaModalIdx
        ? { ...r, usda_fdc_id: food.fdcId, _usdaDesc: food.description,
            ingredient_name: r.ingredient_name || food.description }
        : r
    ));
    setUsdaModalIdx(null);
  }

  if (!isNew && isLoading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (!form) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(isNew ? '/recipes' : `/recipes/${id}`)} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold text-gray-800">
            {isNew ? 'New Recipe' : 'Edit Recipe'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(isNew ? '/recipes' : `/recipes/${id}`)}
            className="px-4 py-1.5 text-sm border rounded-md text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Recipe'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {saveMutation.isError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {saveMutation.error?.response?.data?.error ?? 'Failed to save recipe.'}
          </div>
        )}

        {/* Basic info */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Basic Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="Recipe Name" required>
                <input value={form.name} onChange={e => setField('name', e.target.value)}
                  className={`${INPUT_CLS} ${errors.name ? 'border-red-400' : ''}`} />
                {errors.name && <p className="text-xs text-red-500 mt-0.5">{errors.name}</p>}
              </Field>
            </div>
            <Field label="Category" required>
              <select value={form.category} onChange={e => setField('category', e.target.value)}
                className={`${INPUT_CLS} ${errors.category ? 'border-red-400' : ''}`}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Protein Group">
              <select value={form.protein_group} onChange={e => setField('protein_group', e.target.value)} className={INPUT_CLS}>
                <option value="">— None —</option>
                {PROTEIN_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Base Servings">
              <input type="number" min="1" value={form.base_servings} onChange={e => setField('base_servings', e.target.value)} className={INPUT_CLS} />
            </Field>
            <Field label="Serving Size (oz)">
              <input type="number" step="0.01" value={form.serving_size_oz} onChange={e => setField('serving_size_oz', e.target.value)} className={INPUT_CLS} />
            </Field>
            <Field label="Serving Utensil">
              <input value={form.serving_utensil} onChange={e => setField('serving_utensil', e.target.value)} className={INPUT_CLS} />
            </Field>
            <Field label="Cooking Temp (°F)">
              <input type="number" value={form.cooking_temp_f} onChange={e => setField('cooking_temp_f', e.target.value)} className={INPUT_CLS} />
            </Field>
            <Field label="Internal Temp (°F)">
              <input type="number" value={form.internal_temp_f} onChange={e => setField('internal_temp_f', e.target.value)} className={INPUT_CLS} />
            </Field>
            <Field label="Source">
              <input value={form.source} onChange={e => setField('source', e.target.value)} className={INPUT_CLS} />
            </Field>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Seasons</label>
              <div className="flex gap-2 flex-wrap mt-1">
                {SEASONS_LIST.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSeason(s)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      form.seasons.includes(s)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'text-gray-600 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" id="is_active" checked={form.is_active}
                onChange={e => setField('is_active', e.target.checked)} className="rounded" />
              <label htmlFor="is_active" className="text-sm text-gray-700">Active recipe</label>
            </div>
          </div>
        </section>

        {/* Ingredients */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Ingredients <span className="text-gray-400 font-normal">(per 100 servings)</span>
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={handleAutoLink}
                disabled={autoLinking}
                title="Automatically link USDA FDC IDs for all unlinked ingredients"
                className="flex items-center gap-1 text-xs text-purple-600 hover:underline disabled:opacity-50"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {autoLinking ? 'Linking…' : 'Auto-link USDA'}
              </button>
              <button onClick={addIng} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                <Plus className="w-3.5 h-3.5" />Add Row
              </button>
            </div>
          </div>
          {autoLinkResult && (
            <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded px-3 py-1.5 mb-3 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
              {autoLinkResult}
            </p>
          )}
          <div className="space-y-3">
            {ingredients.map((ing, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-2 bg-gray-50 space-y-2">
                {/* Row 1: name, qty, unit, usda, delete */}
                <div className="flex items-center gap-2">
                  <input
                    value={ing.ingredient_name}
                    onChange={e => setIng(i, 'ingredient_name', e.target.value)}
                    placeholder="Ingredient name"
                    className="flex-1 border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <input
                    type="number"
                    step="0.001"
                    value={ing.quantity_per_100_svgs}
                    onChange={e => setIng(i, 'quantity_per_100_svgs', e.target.value)}
                    placeholder="Qty"
                    className="w-20 border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <select
                    value={ing.unit}
                    onChange={e => setIng(i, 'unit', e.target.value)}
                    className="w-20 border rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <button
                    onClick={() => setUsdaModalIdx(i)}
                    title={
                      ing.usda_fdc_id
                        ? (ing._usdaReason
                            ? `AI selected: ${ing._usdaReason}\nFDC #${ing.usda_fdc_id}${ing._usdaDesc ? ` — ${ing._usdaDesc}` : ''}`
                            : `FDC #${ing.usda_fdc_id}${ing._usdaDesc ? ` — ${ing._usdaDesc}` : ''}`)
                        : 'Search USDA FoodData Central'
                    }
                    className={`p-1.5 rounded border text-xs transition-colors flex items-center gap-1 ${
                      ing.usda_fdc_id
                        ? 'border-green-400 text-green-700 bg-green-50'
                        : 'border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 bg-white'
                    }`}
                  >
                    <Search className="w-3.5 h-3.5" />
                    {ing.usda_fdc_id ? `#${ing.usda_fdc_id}` : 'USDA'}
                    {ing._usdaReason && <Sparkles className="w-3 h-3 opacity-70" />}
                  </button>
                  <button onClick={() => removeIng(i)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {/* Row 2: vendor ordering fields */}
                <div className="flex items-center gap-2">
                  <select
                    value={ing.vendor || 'GFS'}
                    onChange={e => setIng(i, 'vendor', e.target.value)}
                    className="w-24 border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    title="Vendor"
                  >
                    {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                    <option value="">Untagged</option>
                  </select>
                  <input
                    value={ing.gfs_product_code}
                    onChange={e => setIng(i, 'gfs_product_code', e.target.value)}
                    placeholder="Product code (optional)"
                    className="flex-1 border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <input
                    value={ing.case_size}
                    onChange={e => setIng(i, 'case_size', e.target.value)}
                    placeholder='Case size e.g. "6×5 lb"'
                    className="flex-1 border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <input
                    value={ing.order_unit}
                    onChange={e => setIng(i, 'order_unit', e.target.value)}
                    placeholder="Order unit"
                    className="w-24 border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Instructions */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Instructions</h2>
          <p className="text-xs text-gray-500 mb-2">One step per line. Mark CCP steps with "CCP:" for bold formatting in the recipe card.</p>
          <textarea
            value={form.instructions}
            onChange={e => setField('instructions', e.target.value)}
            rows={10}
            placeholder="1. Preheat oven to 350°F&#10;2. CCP: Cook chicken to 165°F internal temp…"
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
          />
        </section>
      </div>

      {usdaModalIdx !== null && (
        <USDASearchModal
          onSelect={handleUsdaSelect}
          onClose={() => setUsdaModalIdx(null)}
        />
      )}
    </div>
  );
}
