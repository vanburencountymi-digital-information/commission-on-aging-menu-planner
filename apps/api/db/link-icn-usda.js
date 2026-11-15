/**
 * ICN CACFP → USDA FDC Auto-Linker
 *
 * For every ICN CACFP recipe_ingredient that lacks a usda_fdc_id:
 *   1. Cleans the ingredient name (strips asterisks, prep notes, plurals, etc.)
 *   2. Searches the USDA FDC API for the best match
 *   3. Prefers: Foundation Food > SR Legacy > Survey (FNDDS) > Branded
 *   4. Writes the winning fdc_id back to recipe_ingredients
 *
 * After linking, recalculates nutrition for all 24 ICN recipes.
 *
 * Run:  node db/link-icn-usda.js
 *
 * Respects USDA rate limits with a 300 ms delay between searches.
 */

import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const USDA_API_KEY = process.env.USDA_API_KEY;
const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_DETAIL = 'https://api.nal.usda.gov/fdc/v1/food';

// Priority order: lower index = better
const DATA_TYPE_RANK = {
  'Foundation':        0,
  'SR Legacy':         1,
  'Survey (FNDDS)':    2,
  'Branded':           3,
};

// ── Name cleaning ─────────────────────────────────────────────────────────────

/**
 * Strip ICN formatting artifacts and simplify the name for FDC search.
 * Examples:
 *   "*Fresh onions, diced"          → "onions"
 *   "Canned kidney beans, drained"  → "kidney beans"
 *   "Frozen corn, thawed"           → "corn"
 *   "Low-sodium chicken broth"      → "chicken broth"
 *   "Canola or vegetable oil"       → "canola oil"
 */
function cleanName(raw) {
  let s = raw
    .replace(/^\*+/, '')                         // leading asterisks
    .replace(/\([^)]*\)/g, '')                   // parenthetical notes (first pass)
    .replace(/\([^)]*\)/g, '')                   // second pass for nested doubles like ((…) )
    .replace(/[()]/g, '')                        // strip any residual bare parens
    .trim();

  // Strip leading measure artifacts (e.g. "2 qt " left by imperfect parsing)
  s = s.replace(/^\d[\d\s./]*(?:qt|gal|cup|cups|oz|lb|lbs|tbsp|tsp)\s+/gi, '');

  // Strip prep/size qualifiers after comma
  s = s.replace(/,\s*(diced|sliced|chopped|minced|drained|rinsed|thawed|cooked|divided|peeled|trimmed|crushed|grated|shredded|softened|melted|packed|sifted|sieved|beaten|to taste|as needed|or more|optional|deboned|cubed|unpeeled|seeded|whole|large|medium|small|see notes.*)[^,]*/gi, '');

  // Strip trailing prep qualifiers not after comma
  s = s.replace(/\s+(diced|sliced|chopped|minced|thawed|cooked|shredded|crumbled|divided|peeled|deboned|squeezed|minced)(\s.*)?$/gi, '');

  // Strip leading state/treatment adjectives (multi-pass for stacked ones)
  const STATE_ADJ = /^(fresh|frozen|canned|dried|raw|cooked|low.sodium|reduced.sodium|no.salt.added|fat.free|nonfat|skim|whole|boneless|skinless|smoked|ground|toasted|prepared|concentrated)\s+/gi;
  s = s.replace(STATE_ADJ, '').replace(STATE_ADJ, '').replace(STATE_ADJ, '');

  // "X or Y" — keep first option
  s = s.replace(/\s+or\s+\S+(\s|$)/i, ' ');

  // "Low-fat X" / "Low-sodium X" → "X"
  s = s.replace(/^(low-fat|low fat|reduced-fat|light|low-sodium|no-salt.added)\s+/gi, '');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  // Truncate at comma (keep primary name)
  s = s.split(',')[0].trim();

  return s;
}

// ── FDC search ────────────────────────────────────────────────────────────────

async function searchFDC(query) {
  const url = `${USDA_SEARCH}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FDC search HTTP ${res.status} for "${query}"`);
  const data = await res.json();
  return data.foods ?? [];
}

/**
 * Pick the best FDC hit from a list of results.
 * Ranks by data type preference, then by description string-similarity.
 */
function bestHit(results, cleanedQuery) {
  if (!results.length) return null;

  // Score each result
  const scored = results.map(r => {
    const rank = DATA_TYPE_RANK[r.dataType] ?? 99;
    const desc = (r.description ?? '').toLowerCase();
    const q = cleanedQuery.toLowerCase();

    // Simple word-overlap score (0–1)
    const qWords = q.split(/\s+/);
    const dWords = new Set(desc.split(/[\s,()]+/));
    const overlap = qWords.filter(w => dWords.has(w)).length / qWords.length;

    return { r, rank, overlap };
  });

  // Sort: lower rank first, then higher overlap
  scored.sort((a, b) => a.rank - b.rank || b.overlap - a.overlap);
  return scored[0].r;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ICN CACFP → USDA FDC Auto-Linker                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // 1. Load all ICN ingredients without an FDC id
  const unlinked = await sql`
    SELECT DISTINCT ON (ri.ingredient_name)
      ri.ingredient_name,
      ARRAY_AGG(ri.id) AS ids
    FROM recipe_ingredients ri
    JOIN recipes r ON r.id = ri.recipe_id
    WHERE r.source = 'ICN CACFP'
      AND (ri.usda_fdc_id IS NULL OR ri.usda_fdc_id = 0)
    GROUP BY ri.ingredient_name
    ORDER BY ri.ingredient_name
  `;

  console.log(`Found ${unlinked.length} distinct unlinked ingredient names.\n`);

  let linked = 0, skipped = 0;

  for (const row of unlinked) {
    const rawName = row.ingredient_name;
    const cleaned = cleanName(rawName);

    process.stdout.write(`  ${rawName.substring(0, 50).padEnd(50)}  `);

    try {
      const results = await searchFDC(cleaned);
      const hit = bestHit(results, cleaned);

      if (!hit) {
        console.log(`— no results`);
        skipped++;
      } else {
        // Update ALL rows sharing this ingredient_name for ICN recipes
        await sql`
          UPDATE recipe_ingredients
          SET usda_fdc_id = ${hit.fdcId}
          WHERE id = ANY(${row.ids})
        `;
        const typeShort = (hit.dataType ?? '?').replace('Survey (FNDDS)', 'Survey').substring(0, 10);
        console.log(`→ ${hit.fdcId}  [${typeShort}]  ${(hit.description ?? '').substring(0, 35)}`);
        linked++;
      }
    } catch (err) {
      console.log(`✗ ${err.message}`);
      skipped++;
    }

    // Polite delay — USDA allows ~3 req/s on free keys
    await new Promise(r => setTimeout(r, 320));
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`Linked: ${linked}   Skipped/No-match: ${skipped}`);
  console.log(`──────────────────────────────────────────────────────────\n`);

  // 2. Recalculate nutrition for all ICN recipes
  console.log('Recalculating nutrition for all ICN CACFP recipes…\n');

  const icnRecipes = await sql`
    SELECT id, name FROM recipes WHERE source = 'ICN CACFP' ORDER BY name
  `;

  // Inline nutrition calculation to avoid ESM import issues when running as a script
  // FDC nutrient IDs (used by batch POST response)
  const NUTRIENT_ID_MAP = {
    1008: 'calories_kcal',
    2048: 'calories_kcal',
    1003: 'protein_g',
    1004: 'fat_total_g',
    1005: 'carbohydrate_g',
    1079: 'fiber_g',
    1093: 'sodium_mg',
    1087: 'calcium_mg',
    1162: 'vitamin_c_mg',
    1114: 'vitamin_d_mcg',
    1092: 'potassium_mg',
    1258: 'sat_fat_g',
  };
  // Classic USDA nutrient numbers (used by single GET abridged response)
  const NUTRIENT_NUMBER_MAP = {
    '208': 'calories_kcal',
    '203': 'protein_g',
    '204': 'fat_total_g',
    '205': 'carbohydrate_g',
    '291': 'fiber_g',
    '307': 'sodium_mg',
    '301': 'calcium_mg',
    '401': 'vitamin_c_mg',
    '328': 'vitamin_d_mcg',
    '306': 'potassium_mg',
    '606': 'sat_fat_g',
  };
  // Alias for backward-compat with other uses in this file
  const NUTRIENT_MAP = NUTRIENT_ID_MAP;

  const UNIT_TO_GRAMS = {
    g: 1, gram: 1, grams: 1,
    oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
    lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
    cup: 240, cups: 240,
    tbsp: 14.787, Tbsp: 14.787, tablespoon: 14.787, tablespoons: 14.787,
    tsp: 4.929, teaspoon: 4.929, teaspoons: 4.929,
    qt: 946.35, quart: 946.35, quarts: 946.35,
    gal: 3785.41, gallon: 3785.41, gallons: 3785.41,
    ml: 1, milliliter: 1, milliliters: 1,
    liter: 1000, liters: 1000,
  };

  const EACH_GRAMS = [
    { pattern: /egg/i, grams: 50 },
    { pattern: /bay leaf|bay leaves/i, grams: 0.3 },
  ];

  function toGrams(quantity, unit, ingredientName) {
    const u = (unit ?? '').toLowerCase().trim();
    if (UNIT_TO_GRAMS[u] !== undefined) return quantity * UNIT_TO_GRAMS[u];
    if (u === 'each') {
      for (const { pattern, grams } of EACH_GRAMS) {
        if (pattern.test(ingredientName)) return quantity * grams;
      }
      return null;
    }
    return null;
  }

  // Fetch nutrients for one FDC id, using DB cache
  async function getNutrients(fdcId) {
    // Check cache first
    const [cached] = await sql`
      SELECT nutrients FROM usda_cache
      WHERE fdc_id = ${fdcId}
        AND fetched_at > NOW() - INTERVAL '7 days'
    `;
    if (cached) return cached.nutrients;

    // Fetch from USDA.
    // Do NOT add &nutrients= filter — it silently returns empty foodNutrients
    // for Foundation Foods. Fetch all nutrients and filter in the loop.
    const res = await fetch(`${USDA_DETAIL}/${fdcId}?format=abridged&api_key=${USDA_API_KEY}`);
    if (!res.ok) return null;
    const data = await res.json();

    const nutrients = {};
    for (const fn of data.foodNutrients ?? []) {
      // Single GET abridged → { number, name, amount }
      // Batch POST abridged → { nutrientId, value } or { nutrient: { id }, amount }
      const col = NUTRIENT_NUMBER_MAP[fn.number]
               ?? NUTRIENT_ID_MAP[fn.nutrientId]
               ?? NUTRIENT_ID_MAP[fn.nutrient?.id];
      if (col && !nutrients[col]) nutrients[col] = fn.amount ?? fn.value ?? 0;
    }

    // Upsert cache
    await sql`
      INSERT INTO usda_cache (fdc_id, nutrients, fetched_at)
      VALUES (${fdcId}, ${sql.json(nutrients)}, NOW())
      ON CONFLICT (fdc_id) DO UPDATE
        SET nutrients = EXCLUDED.nutrients,
            fetched_at    = EXCLUDED.fetched_at
    `;

    await new Promise(r => setTimeout(r, 320));
    return nutrients;
  }

  let calcOk = 0, calcFailed = 0;

  for (const recipe of icnRecipes) {
    process.stdout.write(`  ${recipe.name.substring(0, 55).padEnd(55)}  `);

    try {
      const ingredients = await sql`
        SELECT * FROM recipe_ingredients WHERE recipe_id = ${recipe.id}
      `;

      const zero = () => ({
        calories_kcal: 0, protein_g: 0, fat_total_g: 0, carbohydrate_g: 0,
        sat_fat_g: 0, sodium_mg: 0, fiber_g: 0, calcium_mg: 0,
        vitamin_d_mcg: 0, vitamin_c_mg: 0, potassium_mg: 0,
      });

      const totals = zero();
      let skippedCount = 0;

      for (const ing of ingredients) {
        if (!ing.usda_fdc_id) { skippedCount++; continue; }
        const nutrients = await getNutrients(ing.usda_fdc_id);
        if (!nutrients) { skippedCount++; continue; }

        const grams = toGrams(Number(ing.quantity_per_100_svgs), ing.unit, ing.ingredient_name);
        if (grams === null) { skippedCount++; continue; }

        for (const key of Object.keys(totals)) {
          totals[key] += ((nutrients[key] ?? 0) / 100) * grams;
        }
      }

      // Divide by 100 — quantity_per_100_svgs is always normalized to 100 servings
      const perSvg = {};
      for (const [key, val] of Object.entries(totals)) {
        perSvg[key] = Math.round((val / 100) * 100) / 100;
      }

      await sql`
        INSERT INTO nutrition_profiles
          (recipe_id, calories_kcal, protein_g, carbohydrate_g, fat_total_g, sat_fat_g,
           sodium_mg, fiber_g, calcium_mg, vitamin_d_mcg, vitamin_c_mg, potassium_mg,
           last_calculated_at)
        VALUES
          (${recipe.id},
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
      `;

      const calLabel = perSvg.calories_kcal > 0 ? `${perSvg.calories_kcal} kcal` : 'no data';
      const skipNote = skippedCount > 0 ? `  (${skippedCount} ing skipped)` : '';
      console.log(`✓  ${calLabel}${skipNote}`);
      calcOk++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
      calcFailed++;
    }
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`Nutrition recalculated: ${calcOk}   Failed: ${calcFailed}`);
  console.log(`──────────────────────────────────────────────────────────\n`);

  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
