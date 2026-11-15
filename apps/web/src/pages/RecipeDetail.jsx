import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Edit2, FileText, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { recipesApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const SCALE_PRESETS = [25, 50, 75, 100, 150, 200, 300, 400, 500];

const CAT_COLOR = {
  HOT_ENTREE: 'bg-orange-100 text-orange-700',
  COLD_ENTREE: 'bg-sky-100 text-sky-700',
  SIDE: 'bg-green-100 text-green-700',
  FRUIT: 'bg-pink-100 text-pink-700',
  BREAD: 'bg-yellow-100 text-yellow-700',
  DESSERT: 'bg-purple-100 text-purple-700',
};

function fmtQty(val) {
  const n = Number(val);
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [scale, setScale] = useState(100);
  const [customInput, setCustomInput] = useState('');

  function applyCustom() {
    const n = parseInt(customInput, 10);
    if (!isNaN(n) && n > 0) {
      setScale(n);
      setCustomInput('');
    }
  }

  const { data: recipe, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => recipesApi.get(id),
  });

  const { data: scaled } = useQuery({
    queryKey: ['recipe-scale', id, scale],
    queryFn: () => recipesApi.scale(id, scale),
    enabled: !!recipe && scale !== 100,
  });

  const canEdit = ['NUTRITION_MANAGER', 'ADMIN'].includes(user?.role);

  const recalcMutation = useMutation({
    mutationFn: () => recipesApi.recalculate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nutrition'] });
      qc.invalidateQueries({ queryKey: ['recipe-nutrition', id] });
    },
  });

  // Per-serving nutrition profile. 404 means "not yet calculated" — handled
  // as an explicit empty state, not retried.
  const { data: nutrition, error: nutritionError } = useQuery({
    queryKey: ['recipe-nutrition', id],
    queryFn: () => recipesApi.getNutrition(id),
    enabled: !!id,
    retry: (count, err) => err?.response?.status !== 404 && count < 2,
  });

  const approveMutation = useMutation({
    mutationFn: () => recipesApi.update(id, { is_active: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe', id] });
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipes-pending'] });
    },
  });

  const displayIngredients = scale !== 100 && scaled ? scaled.ingredients : recipe?.ingredients ?? [];

  const isImported    = recipe?.source?.startsWith('Import') ?? false;
  const isAIGenerated = recipe?.source === 'AI Generated';
  const needsReview   = !recipe?.is_active && (isImported || isAIGenerated);

  if (isLoading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (!recipe) return <div className="p-8 text-sm text-red-500">Recipe not found.</div>;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/recipes')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base font-semibold text-gray-800">{recipe.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${CAT_COLOR[recipe.category] ?? 'bg-gray-100 text-gray-600'}`}>
              {recipe.category?.replace('_', ' ')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/recipes/${id}/export/pdf`}
            download
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Print Recipe Card
          </a>
          {canEdit && needsReview && (
            <button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending || approveMutation.isSuccess}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-md transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              {approveMutation.isPending ? 'Approving…' : approveMutation.isSuccess ? 'Approved ✓' : 'Approve for Use'}
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => recalcMutation.mutate()}
              disabled={recalcMutation.isPending}
              title="Recalculate nutrition profile from USDA data"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${recalcMutation.isPending ? 'animate-spin' : ''}`} />
              {recalcMutation.isPending ? 'Calculating…' : recalcMutation.isSuccess ? 'Done ✓' : recalcMutation.isError ? 'Failed ✗' : 'Recalc Nutrition'}
            </button>
          )}
          {canEdit && (
            <Link
              to={`/recipes/${id}/edit`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              Edit
            </Link>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
        {/* RD Review banner */}
        {needsReview && (
          <div className="flex items-start gap-2 p-4 mb-5 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Awaiting RD Review — Inactive</p>
              <p className="text-sm text-amber-700 mt-0.5">
                This recipe has not been reviewed for OAA Title III-C senior DRI compliance.
                {isImported && ` Source: ${recipe.source}.`}
                {' '}It cannot be added to menus until approved.
              </p>
              {canEdit && (
                <button
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || approveMutation.isSuccess}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-md transition-colors"
                >
                  <CheckCircle className="w-4 h-4" />
                  {approveMutation.isPending ? 'Approving…' : approveMutation.isSuccess ? 'Approved ✓' : 'Approve for Use'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Production info */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {[
            ['Base Servings', recipe.base_servings],
            ['Serving Size', recipe.serving_size_oz ? `${recipe.serving_size_oz} oz` : '—'],
            ['Serving Utensil', recipe.serving_utensil ?? '—'],
            ['Cooking Temp', recipe.cooking_temp_f ? `${recipe.cooking_temp_f}°F` : '—'],
            ['Internal Temp', recipe.internal_temp_f ? `${recipe.internal_temp_f}°F` : '—'],
            ['Protein Group', recipe.protein_group ?? '—'],
            ['Seasons', recipe.seasons?.join(', ') || '—'],
            ['Source', recipe.source ?? '—'],
          ].map(([label, val]) => (
            <div key={label} className="flex gap-2">
              <span className="text-xs font-medium text-gray-500 w-32 flex-shrink-0">{label}</span>
              <span className="text-sm text-gray-800">{val}</span>
            </div>
          ))}
        </div>

        {/* Ingredients */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">Ingredients</h2>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="text-xs text-gray-500 flex-shrink-0">Scale to:</span>
              {/* Preset quick-picks */}
              <div className="flex gap-1 flex-wrap">
                {SCALE_PRESETS.map(n => (
                  <button
                    key={n}
                    onClick={() => { setScale(n); setCustomInput(''); }}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      scale === n
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {/* Custom free-form entry */}
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  value={customInput}
                  onChange={e => setCustomInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyCustom()}
                  placeholder="custom…"
                  className="w-20 border rounded text-xs px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button
                  onClick={applyCustom}
                  disabled={!customInput}
                  className="text-xs px-2 py-0.5 rounded border border-blue-400 text-blue-600 hover:bg-blue-50 disabled:opacity-40 transition-colors"
                >
                  Go
                </button>
              </div>
              {/* Active scale badge when not a preset */}
              {!SCALE_PRESETS.includes(scale) && scale !== 100 && (
                <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {scale} servings
                </span>
              )}
            </div>
          </div>
          {displayIngredients.length === 0 ? (
            <p className="text-sm text-gray-400">No ingredients added yet.</p>
          ) : (
            <table className="w-full text-sm border rounded-lg overflow-hidden">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">Ingredient</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-600">Qty</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">Unit</th>
                  {displayIngredients[0]?.usda_fdc_id != null && (
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">FDC ID</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {displayIngredients.map((ing, i) => (
                  <tr key={ing.id ?? i} className="border-t">
                    <td className="px-4 py-2 text-gray-800">{ing.ingredient_name}</td>
                    <td className="px-4 py-2 text-right text-gray-700 font-mono text-xs">
                      {fmtQty(ing.scaled_quantity ?? ing.quantity_per_100_svgs)}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{ing.unit}</td>
                    {displayIngredients[0]?.usda_fdc_id != null && (
                      <td className="px-4 py-2 text-gray-400 text-xs">{ing.usda_fdc_id ?? '—'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Nutrition (per serving) — pulls from cached nutrition_profile.
            Per-recipe values shown as a plain table (no DRI bars) — a single
            recipe isn't meant to hit per-meal compliance targets on its own. */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">Nutrition (per serving)</h2>
            {nutrition?.last_calculated_at && (
              <span className="text-xs text-gray-400">
                Last calculated {new Date(nutrition.last_calculated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            )}
          </div>

          {nutritionError?.response?.status === 404 ? (
            <p className="text-sm text-gray-500 border rounded-lg p-4 bg-gray-50">
              Nutrition not calculated yet — click <strong>Recalc Nutrition</strong> above to generate values from the linked USDA ingredients.
            </p>
          ) : !nutrition ? (
            <p className="text-sm text-gray-400">Loading nutrition…</p>
          ) : (
            <>
              {(() => {
                const unlinked = (recipe.ingredients ?? []).filter(i => !i.usda_fdc_id).length;
                return unlinked > 0 ? (
                  <p className="text-xs text-amber-600 mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {unlinked} ingredient{unlinked !== 1 ? 's' : ''} missing USDA links — values below are partial.
                  </p>
                ) : null;
              })()}
              <div className="grid grid-cols-2 gap-x-6 text-sm border rounded-lg p-4">
                {[
                  ['Calories',       nutrition.calories_kcal,  'kcal'],
                  ['Protein',        nutrition.protein_g,      'g'],
                  ['Carbohydrate',   nutrition.carbohydrate_g, 'g'],
                  ['Total Fat',      nutrition.fat_total_g,    'g'],
                  ['Saturated Fat',  nutrition.sat_fat_g,      'g'],
                  ['Fiber',          nutrition.fiber_g,        'g'],
                  ['Sodium',         nutrition.sodium_mg,      'mg'],
                  ['Calcium',        nutrition.calcium_mg,     'mg'],
                  ['Vitamin D',      nutrition.vitamin_d_mcg,  'mcg'],
                  ['Vitamin C',      nutrition.vitamin_c_mg,   'mg'],
                  ['Potassium',      nutrition.potassium_mg,   'mg'],
                ].map(([label, value, unit]) => (
                  <div key={label} className="flex justify-between py-1.5 border-b border-gray-100 last:border-b-0">
                    <span className="text-gray-600">{label}</span>
                    <span className="text-gray-800 tabular-nums">
                      {value != null ? `${Math.round(Number(value) * 10) / 10} ${unit}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Instructions */}
        {recipe.instructions && (
          <div>
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Instructions</h2>
            <ol className="space-y-2">
              {recipe.instructions.split('\n').filter(s => s.trim()).map((step, i) => {
                const isCCP = /\bCCP\b/i.test(step);
                return (
                  <li key={i} className={`text-sm flex gap-2 ${isCCP ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                    <span className="text-gray-400 flex-shrink-0 w-5 text-right">{i + 1}.</span>
                    <span>{step.trim()}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
