import { Router } from 'express';
import sql from '../db/client.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { aiLightLimiter } from '../middleware/rateLimits.js';
import { searchFoods } from '../services/usda.js';
import { calculateNutrition, checkDRICompliance } from '../services/compliance.js';
import { selectBestFdcMatch } from '../services/ai.js';

const router = Router();

// GET /api/nutrition/usda/search?q=
// [NUTRITION_MANAGER, ADMIN] Proxy to USDA FoodData Central. Used by the recipe editor to
// find FDC IDs for ingredients. Authenticated so the shared USDA API key can't be burned anonymously.
router.get('/usda/search', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.status(400).json({ error: 'q is required' });
    const results = await searchFoods(q.trim());
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'USDA search failed' });
  }
});

// POST /api/nutrition/usda/ai-link  [NUTRITION_MANAGER, ADMIN]
// Body: { ingredient_name, recipe_name?, recipe_category? }
// Searches USDA FDC, uses Claude to select the best match from top 5 candidates.
// Falls back to top relevance result if Claude is unavailable.
router.post('/usda/ai-link', requireAuth('NUTRITION_MANAGER', 'ADMIN'), aiLightLimiter, async (req, res) => {
  try {
    const { ingredient_name, recipe_name, recipe_category } = req.body;
    if (!ingredient_name?.trim()) {
      return res.status(400).json({ error: 'ingredient_name is required' });
    }

    const candidates = await searchFoods(ingredient_name.trim());
    if (candidates.length === 0) {
      return res.json({ fdcId: null, description: null, reason: null });
    }

    // With multiple candidates, ask Claude to pick the best one
    if (candidates.length > 1) {
      try {
        const result = await selectBestFdcMatch({
          ingredientName: ingredient_name.trim(),
          recipeName:     recipe_name     ?? '',
          recipeCategory: recipe_category ?? '',
          candidates: candidates.slice(0, 5),
        });
        return res.json(result);
      } catch (aiErr) {
        // AI unavailable or failed — fall through to top-result fallback
        console.warn('[ai-link] AI selection failed, using top result:', aiErr.message);
      }
    }

    // Fallback: return the top relevance-ranked result with no reason
    res.json({ fdcId: candidates[0].fdcId, description: candidates[0].description, reason: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'USDA AI link failed' });
  }
});

// GET /api/nutrition/recipe/:recipeId
// Return the cached NutritionProfile for a recipe, or 404 if not yet calculated.
router.get('/recipe/:recipeId', async (req, res) => {
  try {
    const [profile] = await sql`
      SELECT np.*, r.name AS recipe_name
      FROM nutrition_profiles np
      JOIN recipes r ON r.id = np.recipe_id
      WHERE np.recipe_id = ${req.params.recipeId}
    `;
    if (!profile) return res.status(404).json({ error: 'No nutrition profile — call /recalculate first' });
    res.json({ ...profile, compliance: checkDRICompliance(profile) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch nutrition profile' });
  }
});

// POST /api/nutrition/recipe/:recipeId/recalculate  [NUTRITION_MANAGER, ADMIN]
// Triggers a fresh calculation from USDA ingredient data.
router.post('/recipe/:recipeId/recalculate', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const profile = await calculateNutrition(req.params.recipeId);
    res.json({ ...profile, compliance: checkDRICompliance(profile) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nutrition/day/:menuDayId
// Summed daily nutrition totals for a MenuDay vs OAA DRI targets.
router.get('/day/:menuDayId', async (req, res) => {
  try {
    const items = await sql`
      SELECT mdi.recipe_id, r.name AS recipe_name
      FROM menu_day_items mdi
      JOIN recipes r ON r.id = mdi.recipe_id
      WHERE mdi.menu_day_id = ${req.params.menuDayId}
    `;
    if (items.length === 0) return res.json({ totals: null, compliance: [], recipes: [] });

    const profiles = await sql`
      SELECT * FROM nutrition_profiles
      WHERE recipe_id = ANY(${items.map(i => i.recipe_id)})
    `;
    const byRecipe = Object.fromEntries(profiles.map(p => [p.recipe_id, p]));

    const keys = ['calories_kcal','protein_g','fat_total_g','carbohydrate_g','sat_fat_g',
                  'sodium_mg','fiber_g','calcium_mg','vitamin_d_mcg','vitamin_c_mg','potassium_mg'];
    const totals = Object.fromEntries(keys.map(k => [k, 0]));
    const missing = [];

    for (const item of items) {
      const p = byRecipe[item.recipe_id];
      if (!p) { missing.push(item.recipe_name); continue; }
      for (const k of keys) totals[k] += Number(p[k] ?? 0);
    }

    res.json({
      totals,
      compliance: checkDRICompliance(totals),
      recipes_without_nutrition: missing,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to calculate day nutrition' });
  }
});

export default router;
