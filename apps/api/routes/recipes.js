import { Router } from 'express';
import sql from '../db/client.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { aiHeavyLimiter } from '../middleware/rateLimits.js';
import { generateRecipeCardPdf } from '../services/pdf.js';
import { generateRecipe, parseRecipeFromText } from '../services/ai.js';

const router = Router();

// GET /api/recipes
// Returns all active recipes. Optional filters: ?category=HOT_ENTREE&protein_group=CHICKEN&season=SUMMER
router.get('/', async (req, res) => {
  try {
    const { category, protein_group, season } = req.query;

    const recipes = await sql`
      SELECT * FROM recipes
      WHERE is_active = true
        ${category      ? sql`AND category      = ${category}`      : sql``}
        ${protein_group ? sql`AND protein_group = ${protein_group}` : sql``}
        ${season        ? sql`AND ${season} = ANY(seasons)`         : sql``}
      ORDER BY category, name
    `;
    res.json(recipes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});

// GET /api/recipes/pending-review  [NUTRITION_MANAGER, DIETITIAN, ADMIN]
// Returns inactive recipes awaiting RD review (AI Generated + Imported).
// MUST be registered before /:id so Express doesn't treat "pending-review" as an ID.
router.get('/pending-review', requireAuth('NUTRITION_MANAGER', 'DIETITIAN', 'ADMIN'), async (req, res) => {
  try {
    const pending = await sql`
      SELECT * FROM recipes
      WHERE is_active = false
        AND (source = 'AI Generated' OR source ILIKE 'Imported%')
      ORDER BY created_at DESC
    `;
    res.json(pending);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pending recipes' });
  }
});

// GET /api/recipes/:id
// Returns single recipe with its ingredients joined
router.get('/:id', async (req, res) => {
  try {
    const [recipe] = await sql`
      SELECT * FROM recipes WHERE id = ${req.params.id}
    `;
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    const ingredients = await sql`
      SELECT * FROM recipe_ingredients
      WHERE recipe_id = ${req.params.id}
      ORDER BY ingredient_name
    `;

    res.json({ ...recipe, ingredients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recipe' });
  }
});

// POST /api/recipes  [requires NUTRITION_MANAGER or ADMIN]
// Insert a new recipe. Returns the created record.
router.post('/', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const {
      name, category, base_servings = 100, serving_size_oz, serving_utensil,
      cooking_temp_f, internal_temp_f, instructions, protein_group,
      seasons = [], source, is_active = true,
    } = req.body;

    if (!name || !category) {
      return res.status(400).json({ error: 'name and category are required' });
    }

    const [recipe] = await sql`
      INSERT INTO recipes
        (name, category, base_servings, serving_size_oz, serving_utensil,
         cooking_temp_f, internal_temp_f, instructions, protein_group,
         seasons, source, is_active)
      VALUES
        (${name}, ${category}, ${base_servings}, ${serving_size_oz ?? null},
         ${serving_utensil ?? null}, ${cooking_temp_f ?? null},
         ${internal_temp_f ?? null}, ${instructions ?? null},
         ${protein_group ?? null}, ${seasons}, ${source ?? null}, ${is_active})
      RETURNING *
    `;
    res.status(201).json(recipe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create recipe' });
  }
});

// PUT /api/recipes/:id  [requires NUTRITION_MANAGER or ADMIN]
// Update recipe fields. Returns the updated record.
router.put('/:id', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const {
      name, category, base_servings, serving_size_oz, serving_utensil,
      cooking_temp_f, internal_temp_f, instructions, protein_group,
      seasons, source, is_active,
    } = req.body;

    const [existing] = await sql`SELECT id FROM recipes WHERE id = ${req.params.id}`;
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });

    const [recipe] = await sql`
      UPDATE recipes SET
        name             = COALESCE(${name            ?? null}, name),
        category         = COALESCE(${category        ?? null}::recipe_category, category),
        base_servings    = COALESCE(${base_servings   ?? null}, base_servings),
        serving_size_oz  = COALESCE(${serving_size_oz ?? null}, serving_size_oz),
        serving_utensil  = COALESCE(${serving_utensil ?? null}, serving_utensil),
        cooking_temp_f   = COALESCE(${cooking_temp_f  ?? null}, cooking_temp_f),
        internal_temp_f  = COALESCE(${internal_temp_f ?? null}, internal_temp_f),
        instructions     = COALESCE(${instructions    ?? null}, instructions),
        protein_group    = COALESCE(${protein_group   ?? null}::protein_group, protein_group),
        seasons          = COALESCE(${seasons         ?? null}, seasons),
        source           = COALESCE(${source          ?? null}, source),
        is_active        = COALESCE(${is_active       ?? null}, is_active),
        updated_at       = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    res.json(recipe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update recipe' });
  }
});

// POST /api/recipes/import  [NUTRITION_MANAGER, ADMIN]
// Body: { text, source_name?, category_hint? }
// Claude parses the pasted recipe text and saves as inactive for RD review.
router.post('/import', requireAuth('NUTRITION_MANAGER', 'ADMIN'), aiHeavyLimiter, async (req, res) => {
  try {
    const { text, source_name, category_hint } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

    const parsed = await parseRecipeFromText({
      text:         text.trim(),
      sourceName:   source_name?.trim()   ?? null,
      categoryHint: category_hint?.trim() ?? null,
    });

    const sourceTag = source_name?.trim()
      ? `Imported: ${source_name.trim()}`
      : 'Imported';

    const [recipe] = await sql`
      INSERT INTO recipes
        (name, category, base_servings, serving_size_oz, serving_utensil,
         cooking_temp_f, internal_temp_f, instructions, protein_group,
         seasons, source, is_active, created_by)
      VALUES
        (${parsed.name}, ${parsed.category}, ${parsed.base_servings ?? 100},
         ${parsed.serving_size_oz ?? null}, ${parsed.serving_utensil ?? null},
         ${parsed.cooking_temp_f ?? null}, ${parsed.internal_temp_f ?? null},
         ${parsed.instructions ?? null},
         ${parsed.protein_group ?? null},
         ${parsed.seasons ?? []}, ${sourceTag}, ${false}, ${req.user.id})
      RETURNING *
    `;

    let ingredients = [];
    if (parsed.ingredients?.length > 0) {
      const rows = parsed.ingredients.map(ing => ({
        recipe_id:             recipe.id,
        ingredient_name:       ing.ingredient_name,
        quantity_per_100_svgs: ing.quantity_per_100_svgs,
        unit:                  ing.unit,
        usda_fdc_id:           ing.usda_fdc_id      ?? null,
        vendor:                ing.vendor            ?? 'GFS',
        gfs_product_code:      ing.gfs_product_code  ?? null,
        case_size:             ing.case_size         ?? null,
        order_unit:            ing.order_unit        ?? null,
      }));
      ingredients = await sql`INSERT INTO recipe_ingredients ${sql(rows)} RETURNING *`;
    }

    res.status(201).json({
      ...recipe,
      ingredients,
      warning: 'This recipe has not been reviewed for OAA Title III-C senior DRI compliance. It must be approved by the RD before use in menus.',
    });
  } catch (err) {
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to import recipe' });
  }
});

// POST /api/recipes/bulk-set-vendor  [NUTRITION_MANAGER, ADMIN]
// Body: { recipe_ids: [uuid, ...], vendor: string }
// Sets vendor on all recipe_ingredients for the given recipes.
router.post('/bulk-set-vendor', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { recipe_ids, vendor } = req.body;
    if (!Array.isArray(recipe_ids) || recipe_ids.length === 0) {
      return res.status(400).json({ error: 'recipe_ids must be a non-empty array' });
    }
    if (!vendor?.trim()) {
      return res.status(400).json({ error: 'vendor is required' });
    }
    const result = await sql`
      UPDATE recipe_ingredients
      SET vendor = ${vendor.trim()}
      WHERE recipe_id = ANY(${recipe_ids})
    `;
    res.json({ updated: result.count, vendor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to bulk-set vendor' });
  }
});

// POST /api/recipes/generate  [NUTRITION_MANAGER, ADMIN]
// Body: { description, category, season?, constraints? }
// Calls Claude, saves as inactive AI-generated recipe, returns full record + ingredients.
router.post('/generate', requireAuth('NUTRITION_MANAGER', 'ADMIN'), aiHeavyLimiter, async (req, res) => {
  try {
    const { description, category, season, constraints } = req.body;
    if (!description?.trim()) return res.status(400).json({ error: 'description is required' });
    if (!category) return res.status(400).json({ error: 'category is required' });

    // Load a few existing recipes as format examples
    const exampleRecipes = await sql`
      SELECT name, category, base_servings, serving_size_oz, serving_utensil, instructions
      FROM recipes WHERE category = ${category} AND is_active = true
      ORDER BY created_at DESC LIMIT 3
    `;

    const generated = await generateRecipe({ description, category, season, constraints, exampleRecipes });

    // Save recipe as inactive, source = 'AI Generated'
    const [recipe] = await sql`
      INSERT INTO recipes
        (name, category, base_servings, serving_size_oz, serving_utensil,
         cooking_temp_f, internal_temp_f, instructions, protein_group,
         seasons, source, is_active, created_by)
      VALUES
        (${generated.name}, ${generated.category}, ${generated.base_servings ?? 100},
         ${generated.serving_size_oz ?? null}, ${generated.serving_utensil ?? null},
         ${generated.cooking_temp_f ?? null}, ${generated.internal_temp_f ?? null},
         ${generated.instructions ?? null},
         ${generated.protein_group ?? null},
         ${generated.seasons ?? []}, ${'AI Generated'}, ${false}, ${req.user.id})
      RETURNING *
    `;

    // Save ingredients
    let ingredients = [];
    if (generated.ingredients?.length > 0) {
      const rows = generated.ingredients.map(ing => ({
        recipe_id:             recipe.id,
        ingredient_name:       ing.ingredient_name,
        quantity_per_100_svgs: ing.quantity_per_100_svgs,
        unit:                  ing.unit,
        usda_fdc_id:           ing.usda_fdc_id           ?? null,
        vendor:                ing.vendor                ?? 'GFS',
        gfs_product_code:      ing.gfs_product_code      ?? null,
        case_size:             ing.case_size             ?? null,
        order_unit:            ing.order_unit            ?? null,
      }));
      ingredients = await sql`INSERT INTO recipe_ingredients ${sql(rows)} RETURNING *`;
    }

    res.status(201).json({ ...recipe, ingredients });
  } catch (err) {
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to generate recipe' });
  }
});

// GET /api/recipes/:id/scale/:n
// Return ingredients scaled to n servings (any positive integer).
// quantity_per_100_svgs is always normalized to 100 servings, so factor = n / 100.
// base_servings is informational only (original recipe yield) — NOT the denominator.
router.get('/:id/scale/:n', async (req, res) => {
  try {
    const n = parseInt(req.params.n, 10);

    if (isNaN(n) || n <= 0) {
      return res.status(400).json({ error: 'n must be a positive integer' });
    }

    const [recipe] = await sql`SELECT * FROM recipes WHERE id = ${req.params.id}`;
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    const ingredients = await sql`
      SELECT * FROM recipe_ingredients WHERE recipe_id = ${req.params.id}
      ORDER BY ingredient_name
    `;

    const factor = n / 100;
    const scaled = ingredients.map(ing => ({
      ...ing,
      quantity_per_100_svgs: undefined,
      scaled_quantity: Number((ing.quantity_per_100_svgs * factor).toFixed(3)),
      unit: ing.unit,
    }));

    res.json({ ...recipe, target_servings: n, scale_factor: factor, ingredients: scaled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to scale recipe' });
  }
});

// PUT /api/recipes/:id/ingredients  [NUTRITION_MANAGER, ADMIN]
// Replaces all ingredients for a recipe. Body: [{ ingredient_name, quantity_per_100_svgs, unit, usda_fdc_id? }]
router.put('/:id/ingredients', requireAuth('NUTRITION_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const [existing] = await sql`SELECT id FROM recipes WHERE id = ${req.params.id}`;
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });

    const list = req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Body must be an array of ingredients' });

    await sql`DELETE FROM recipe_ingredients WHERE recipe_id = ${req.params.id}`;

    let inserted = [];
    if (list.length > 0) {
      const rows = list.map(ing => ({
        recipe_id:             req.params.id,
        ingredient_name:       ing.ingredient_name,
        quantity_per_100_svgs: ing.quantity_per_100_svgs,
        unit:                  ing.unit,
        usda_fdc_id:           ing.usda_fdc_id           ?? null,
        vendor:                ing.vendor                ?? 'GFS',
        gfs_product_code:      ing.gfs_product_code      ?? null,
        case_size:             ing.case_size             ?? null,
        order_unit:            ing.order_unit            ?? null,
      }));
      inserted = await sql`INSERT INTO recipe_ingredients ${sql(rows)} RETURNING *`;
    }

    res.json(inserted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update ingredients' });
  }
});

// GET /api/recipes/:id/export/pdf
// Streams a production recipe card PDF.
router.get('/:id/export/pdf', async (req, res) => {
  try {
    const [recipe] = await sql`SELECT * FROM recipes WHERE id = ${req.params.id}`;
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    const ingredients = await sql`
      SELECT * FROM recipe_ingredients WHERE recipe_id = ${req.params.id}
      ORDER BY ingredient_name
    `;

    generateRecipeCardPdf(recipe, ingredients, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

export default router;
