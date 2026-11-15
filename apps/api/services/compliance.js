import sql from '../db/client.js';
import { getFoodNutrientsBatch } from './usda.js';

// OAA Title III-C compliance targets — 1/3 DRI for Adults 70+
// Source: Technical Implementation Specification v1.1, Section 6
// ADMIN-only to change. All changes must be confirmed by COA's RD before go-live.
const OAA_TARGETS = {
  calories_kcal:  { min: 600,  label: 'Calories',   unit: 'kcal' },
  protein_g:      { min: 19,   label: 'Protein',    unit: 'g'    },
  fiber_g:        { min: 8,    label: 'Fiber',      unit: 'g'    },
  sodium_mg:      { max: 800,  label: 'Sodium',     unit: 'mg'   },
  calcium_mg:     { min: 400,  label: 'Calcium',    unit: 'mg'   },
  vitamin_d_mcg:  { min: 5,    label: 'Vitamin D',  unit: 'mcg'  },
  vitamin_c_mg:   { min: 28,   label: 'Vitamin C',  unit: 'mg'   },
  potassium_mg:   { min: 1167, label: 'Potassium',  unit: 'mg'   },
  // Saturated fat < 10% of calories — checked separately
};

// Unit → grams conversion. Assumes water density for volume units (cups, tbsp, tsp).
// quantity_per_100_svgs is always normalized to 100 servings regardless of base_servings.
const UNIT_TO_GRAMS = {
  g: 1, gram: 1, grams: 1,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
  cup: 240, cups: 240,
  tbsp: 14.787, tablespoon: 14.787, tablespoons: 14.787,
  tsp: 4.929, teaspoon: 4.929, teaspoons: 4.929,
  qt: 946.35, quart: 946.35, quarts: 946.35,         // qt abbreviation added
  gal: 3785.41, gallon: 3785.41, gallons: 3785.41,   // gal abbreviation added
  ml: 1, milliliter: 1, milliliters: 1,
  liter: 1000, liters: 1000,
};

// Gram weights for common "each" ingredients
const EACH_GRAMS = [
  { pattern: /egg/i,               grams: 50   },
  { pattern: /bay leaf|bay leaves/i, grams: 0.3 },
];

function toGrams(quantity, unit, ingredientName) {
  const u = unit.toLowerCase().trim();
  if (UNIT_TO_GRAMS[u] !== undefined) return quantity * UNIT_TO_GRAMS[u];
  if (u === 'each') {
    for (const { pattern, grams } of EACH_GRAMS) {
      if (pattern.test(ingredientName)) return quantity * grams;
    }
    return null; // unknown "each" — skip
  }
  return null; // unknown unit — skip
}

const ZERO_NUTRIENTS = () => ({
  calories_kcal: 0, protein_g: 0, fat_total_g: 0, carbohydrate_g: 0,
  sat_fat_g: 0, sodium_mg: 0, fiber_g: 0, calcium_mg: 0,
  vitamin_d_mcg: 0, vitamin_c_mg: 0, potassium_mg: 0,
});

// Calculate per-serving nutrition for a recipe from its ingredients + USDA data.
// Upserts result into nutrition_profiles. Returns the profile.
export async function calculateNutrition(recipeId) {
  const [recipe] = await sql`SELECT * FROM recipes WHERE id = ${recipeId}`;
  if (!recipe) throw new Error('Recipe not found');

  const ingredients = await sql`
    SELECT * FROM recipe_ingredients WHERE recipe_id = ${recipeId}
  `;

  const fdcIds = [...new Set(ingredients.filter(i => i.usda_fdc_id).map(i => i.usda_fdc_id))];
  const nutrientMap = fdcIds.length > 0 ? await getFoodNutrientsBatch(fdcIds) : {};

  const totals = ZERO_NUTRIENTS();
  const skipped = [];

  for (const ing of ingredients) {
    if (!ing.usda_fdc_id) { skipped.push(ing.ingredient_name); continue; }
    const nutrients = nutrientMap[ing.usda_fdc_id];
    if (!nutrients) { skipped.push(ing.ingredient_name); continue; }

    const grams = toGrams(Number(ing.quantity_per_100_svgs), ing.unit, ing.ingredient_name);
    if (grams === null) { skipped.push(ing.ingredient_name); continue; }

    for (const key of Object.keys(totals)) {
      totals[key] += ((nutrients[key] ?? 0) / 100) * grams;
    }
  }

  // Per-serving values (rounded to 2 dp).
  // quantity_per_100_svgs is always normalized to 100 servings, so we always
  // divide by 100 here — base_servings is informational only.
  const perSvg = {};
  for (const [key, val] of Object.entries(totals)) {
    perSvg[key] = Math.round((val / 100) * 100) / 100;
  }

  const [profile] = await sql`
    INSERT INTO nutrition_profiles
      (recipe_id, calories_kcal, protein_g, carbohydrate_g, fat_total_g, sat_fat_g,
       sodium_mg, fiber_g, calcium_mg, vitamin_d_mcg, vitamin_c_mg, potassium_mg,
       last_calculated_at)
    VALUES
      (${recipeId},
       ${perSvg.calories_kcal}, ${perSvg.protein_g},    ${perSvg.carbohydrate_g},
       ${perSvg.fat_total_g},   ${perSvg.sat_fat_g},    ${perSvg.sodium_mg},
       ${perSvg.fiber_g},       ${perSvg.calcium_mg},   ${perSvg.vitamin_d_mcg},
       ${perSvg.vitamin_c_mg},  ${perSvg.potassium_mg}, NOW())
    ON CONFLICT (recipe_id) DO UPDATE SET
      calories_kcal      = EXCLUDED.calories_kcal,
      protein_g          = EXCLUDED.protein_g,
      carbohydrate_g     = EXCLUDED.carbohydrate_g,
      fat_total_g        = EXCLUDED.fat_total_g,
      sat_fat_g          = EXCLUDED.sat_fat_g,
      sodium_mg          = EXCLUDED.sodium_mg,
      fiber_g            = EXCLUDED.fiber_g,
      calcium_mg         = EXCLUDED.calcium_mg,
      vitamin_d_mcg      = EXCLUDED.vitamin_d_mcg,
      vitamin_c_mg       = EXCLUDED.vitamin_c_mg,
      potassium_mg       = EXCLUDED.potassium_mg,
      last_calculated_at = EXCLUDED.last_calculated_at,
      updated_at         = NOW()
    RETURNING *
  `;

  return { ...profile, skipped_ingredients: skipped };
}

// Returns per-nutrient status against OAA DRI targets.
// status: 'ok' | 'warning' (within 10% of limit) | 'low' (below min) | 'over' (above max)
export function checkDRICompliance(nutritionProfile) {
  const rows = Object.entries(OAA_TARGETS).map(([nutrient, { min, max, label, unit }]) => {
    const actual = Number(nutritionProfile[nutrient] ?? 0);
    let status = 'ok';
    let pct = null;

    if (min != null) {
      pct = min > 0 ? Math.round((actual / min) * 100) : null;
      if (actual < min * 0.9) status = 'low';
      else if (actual < min) status = 'warning';
    } else if (max != null) {
      pct = max > 0 ? Math.round((actual / max) * 100) : null;
      if (actual > max) status = 'over';
      else if (actual > max * 0.9) status = 'warning';
    }

    return { nutrient, label, unit, target: min ?? max, targetType: min != null ? 'min' : 'max', actual, pct, status };
  });

  // Saturated fat < 10% of calories
  const satFatPct = nutritionProfile.calories_kcal > 0
    ? ((nutritionProfile.sat_fat_g ?? 0) * 9 / nutritionProfile.calories_kcal) * 100
    : 0;
  rows.push({
    nutrient: 'sat_fat_pct',
    label: 'Saturated Fat',
    unit: '% kcal',
    target: 10,
    targetType: 'max',
    actual: Math.round(satFatPct * 10) / 10,
    pct: Math.round(satFatPct * 10),
    status: satFatPct >= 10 ? 'over' : satFatPct >= 9 ? 'warning' : 'ok',
  });

  return rows;
}

// Simple issue-list compliance check (used by conflict detection).
export function checkCompliance(nutritionProfile) {
  const issues = [];

  for (const [nutrient, limits] of Object.entries(OAA_TARGETS)) {
    const value = nutritionProfile[nutrient];
    if (value == null) continue;
    if (limits.min != null && value < limits.min)
      issues.push({ nutrient, severity: 'FLAG', message: `${nutrient} ${value} below target of ${limits.min}` });
    if (limits.max != null && value > limits.max)
      issues.push({ nutrient, severity: 'FLAG', message: `${nutrient} ${value} exceeds limit of ${limits.max}` });
  }

  const { sat_fat_g, calories_kcal } = nutritionProfile;
  if (sat_fat_g != null && calories_kcal != null && calories_kcal > 0) {
    const pct = (sat_fat_g * 9) / calories_kcal * 100;
    if (pct >= 10)
      issues.push({ nutrient: 'sat_fat_g', severity: 'FLAG', message: `Saturated fat ${pct.toFixed(1)}% of calories (limit 10%)` });
  }

  return { compliant: issues.length === 0, issues };
}
