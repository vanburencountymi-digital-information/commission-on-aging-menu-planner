/**
 * ICN CACFP Adult-Portion Recipe Importer
 *
 * Fetches 24 USDA-standardized recipes from the ICN Child Nutrition Recipe Box
 * (CACFP Adult Portions section) and imports them into the COA Menu Planner
 * recipe database with full nutrition profiles and ingredient lists.
 *
 * Source:  https://theicn.org/cnrb/recipes-cacfp-adult-portions/
 * License: USDA public-domain content
 *
 * Run:     node db/import-icn.js
 *          (set DATABASE_URL in env or apps/api/.env first)
 */

import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

// ── Recipe manifest ───────────────────────────────────────────────────────────
// category and protein_group are manually assigned based on CACFP classification.
// All recipes: source = 'ICN CACFP', base_servings = 50, seasons = {} (year-round)

const RECIPES = [
  // ── Cold entrees (sandwiches, wraps, protein salads) ──
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-sandwiches/asian-tuna-burgers-usda-recipe-for-cacfp-adult/',               category: 'COLD_ENTREE', protein_group: 'FISH' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-sandwiches/jerk-fish-wrap-usda-recipe-for-cacfp-adult/',                    category: 'COLD_ENTREE', protein_group: 'FISH' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-salads/barbecue-chicken-or-turkey-salad-usda-recipe-for-cacfp-adult/',      category: 'COLD_ENTREE', protein_group: 'CHICKEN' },

  // ── Hot entrees (main dishes, soups) ──
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/bean-burrito-bowl-vegetable-usda-recipe-for-cacfp-adult/',      category: 'HOT_ENTREE', protein_group: 'LEGUME' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-soup/bean-soup-usda-recipe-for-cacfp-adult/',                               category: 'HOT_ENTREE', protein_group: 'LEGUME' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-soup/beef-vegetable-soup-usda-recipe-for-cacfp-adult/',                     category: 'HOT_ENTREE', protein_group: 'BEEF' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/chicken-fajita-usda-recipe-for-cacfp-adult/',                   category: 'HOT_ENTREE', protein_group: 'CHICKEN' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/chicken-or-turkey-noodles-usda-recipe-for-cacfp-adult/',        category: 'HOT_ENTREE', protein_group: 'CHICKEN' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/cuban-black-beans-and-rice-usda-recipe-for-cacfp-adult/',       category: 'HOT_ENTREE', protein_group: 'LEGUME' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/green-beans-with-potatoes-and-smoked-turkey-usda-recipe-for-cacfp-adult/', category: 'HOT_ENTREE', protein_group: 'CHICKEN' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/ground-turkey-and-beef-spanish-rice-usda-recipe-for-cacfp-adult/', category: 'HOT_ENTREE', protein_group: 'BEEF' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/honey-lime-chicken-usda-recipe-for-cacfp-adult/',               category: 'HOT_ENTREE', protein_group: 'CHICKEN' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/hoppin-john-usda-recipe-for-cacfp-adult/',                      category: 'HOT_ENTREE', protein_group: 'LEGUME' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/macaroni-and-cheese-usda-recipe-for-cacfp-adult/',              category: 'HOT_ENTREE', protein_group: 'OTHER' },

  // ── Sides (vegetables, salads, starches) ──
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-vegetables/baked-beans-usda-recipe-for-cacfp-adult/',                       category: 'SIDE', protein_group: 'LEGUME' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/baked-sweet-potatoes-with-apples-usda-recipe-for-adults-in-cacfp/', category: 'SIDE', protein_group: 'OTHER' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/brown-rice-pilaf-usda-recipe-for-cacfp-adult/',                   category: 'SIDE', protein_group: 'OTHER' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-salads/carrot-raisin-salad-usda-recipe-for-cacfp-adult/',                   category: 'SIDE', protein_group: 'OTHER' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/corn-and-edamame-blend-usda-recipe-for-cacfp-adult/',             category: 'SIDE', protein_group: 'OTHER' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/corn-pudding-usda-recipe-for-cacfp-adult/',                       category: 'SIDE', protein_group: 'OTHER' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/creamy-coleslaw-usda-recipe-for-adults-in-cacfp/',                category: 'SIDE', protein_group: 'OTHER' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/local-harvest-bake-usda-recipe-for-cacfp-adult/',                 category: 'SIDE', protein_group: 'OTHER' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-salads/macaroni-salad-usda-recipe-for-cacfp-adult/',                        category: 'SIDE', protein_group: 'OTHER' },
  { url: 'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-salads/marinated-black-bean-salad-usda-recipe-for-cacfp-adult/',            category: 'SIDE', protein_group: 'LEGUME' },
];

// ── Parsing helpers ───────────────────────────────────────────────────────────

const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
               '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

// All volume units expressed in fluid tablespoons
const VOL_IN_TBSP = {
  gal: 256, gallon: 256, gallons: 256,
  qt: 64,  quart: 64,  quarts: 64,
  pt: 32,  pint: 32,   pints: 32,
  cup: 16, cups: 16,
  Tbsp: 1, tbsp: 1, tablespoon: 1, tablespoons: 1,
  tsp: 1/3, teaspoon: 1/3, teaspoons: 1/3,
};

/**
 * Choose the most readable volume unit for totalTbsp.
 * Prefers cups for large amounts, Tbsp/tsp for small amounts.
 */
function tbspToReadable(totalTbsp) {
  const t = Math.round(totalTbsp * 1e4) / 1e4;
  if (t >= 16)  return { qty: Math.round((t / 16) * 100) / 100, unit: 'cup' };
  if (t >= 3)   return { qty: Math.round(t * 100) / 100, unit: 'Tbsp' };
  const tspVal = Math.round(t * 3 * 100) / 100;
  // Prefer whole-number tsp for small amounts
  if (Math.abs(tspVal - Math.round(tspVal)) < 0.01) return { qty: Math.round(tspVal), unit: 'tsp' };
  return t >= 1
    ? { qty: Math.round(t * 100) / 100, unit: 'Tbsp' }
    : { qty: tspVal, unit: 'tsp' };
}

/**
 * Replace unicode mixed numbers and standalone fractions in a string.
 *   "3½" → "3.5"    "¼" → "0.25"
 */
function normFracs(s) {
  for (const [frac, val] of Object.entries(FRAC)) {
    // Mixed number: "3½" → "3.5"
    s = s.replace(new RegExp(`(\\d)${frac}`, 'g'), (_, d) => String(parseFloat(d) + val));
    // Standalone fraction: "½" → "0.5"
    s = s.replace(new RegExp(frac, 'g'), String(val));
  }
  return s;
}

/**
 * Split an ICN ingredient string at the LAST run of 2+ spaces.
 * Everything before → quantity complex; everything after → ingredient name.
 *
 *   "3½ cups  Honey"            → { qtyStr: "3½ cups",     name: "Honey" }
 *   "3 qt  2 cups  Water"       → { qtyStr: "3 qt  2 cups", name: "Water" }
 *   "¼ cup  1 Tbsp  Old Bay"    → { qtyStr: "¼ cup  1 Tbsp", name: "Old Bay" }
 *   "1 qt 2 cups  *Onions"      → { qtyStr: "1 qt 2 cups",  name: "*Onions" }
 *   "- - Lime zest"             → { qtyStr: null,            name: "Lime zest" }
 */
function splitIngStr(s) {
  s = s.trim();
  if (!s || s === '-' || s.startsWith('- ')) {
    return { qtyStr: null, name: s.replace(/^-\s*-?\s*/, '').trim() };
  }
  // Greedy match: last \s{2,} separator
  const m = s.match(/^([\s\S]*\S)\s{2,}(\S[\s\S]*)$/);
  if (!m) return { qtyStr: null, name: s };
  // Strip any leading parenthetical note from the name:
  //   "(approx. 2 No. 10 cans) Canned beans…" → "Canned beans…"
  const name = m[2].trim().replace(/^\([^)]*\)\s*/, '').trim();
  return { qtyStr: m[1].trim(), name };
}

/**
 * Parse a quantity string (possibly compound) into { qty, unit }.
 * Handles:
 *   "3½ cups"        → { qty: 3.5, unit: 'cups' }
 *   "3 qt  2 cups"   → { qty: 14,  unit: 'cup' }   (sum in Tbsp → cups)
 *   "1 qt 2 cups"    → { qty: 12,  unit: 'cup' }   (single-space compound)
 *   "¼ cup  1 Tbsp"  → { qty: 5,   unit: 'Tbsp' }
 *   "1 Tbsp  2 tsp"  → { qty: 5,   unit: 'tsp' }
 *   "18 lb"          → { qty: 18,  unit: 'lb' }
 *   "2 lb  10 oz"    → { qty: 2.625, unit: 'lb' }
 */
function parseQtyStr(qtyStr) {
  if (!qtyStr) return null;
  // Strip parenthetical notes like "(approx. ½ No. 10 can)" — they're kitchen hints, not measures
  const s = normFracs(qtyStr.trim()).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  // Tokenize: extract every [number, unit] pair
  const tokens = [];
  const rx = /(\d+(?:\.\d+)?)\s+([a-zA-Z]+)/g;
  let m;
  while ((m = rx.exec(s)) !== null) {
    tokens.push({ qty: parseFloat(m[1]), unit: m[2] });
  }
  // Bare number, no unit (e.g. count)
  if (tokens.length === 0) {
    const bare = parseFloat(s);
    return isNaN(bare) ? null : { qty: bare, unit: '' };
  }
  if (tokens.length === 1) return tokens[0];

  // Multiple tokens ─ try compound weight: lb + oz
  if (tokens.length === 2 &&
      /^lbs?$/i.test(tokens[0].unit) &&
      /^oz$/i.test(tokens[1].unit)) {
    return { qty: tokens[0].qty + tokens[1].qty / 16, unit: 'lb' };
  }

  // Try compound volume: sum all in Tbsp
  let totalTbsp = 0;
  let allVol = true;
  for (const { qty, unit } of tokens) {
    const factor = VOL_IN_TBSP[unit] ?? VOL_IN_TBSP[unit.toLowerCase()];
    if (factor == null) { allVol = false; break; }
    totalTbsp += qty * factor;
  }
  if (allVol) return tbspToReadable(totalTbsp);

  // Fall back to first token
  return tokens[0];
}

/**
 * Extract 50-serving ingredients and normalize to 100 servings.
 * ICN JSON-LD embeds 4 equal groups: [25W, 25M, 50W, 50M] (W=weight, M=measure).
 * We use the 50M group (measures preferred), falling back to 50W (weights).
 */
function extractIngredients(ingArray) {
  if (!ingArray?.length || ingArray.length % 4 !== 0) {
    if (ingArray?.length) console.warn(`    ⚠ Ingredient count ${ingArray.length} not divisible by 4 — skipping ingredients`);
    return [];
  }
  const n = ingArray.length / 4;
  const g50W = ingArray.slice(n * 2, n * 3); // 50-serving weight column
  const g50M = ingArray.slice(n * 3, n * 4); // 50-serving measure column

  const results = [];
  for (let i = 0; i < n; i++) {
    const meas = splitIngStr(g50M[i] || '');
    const wt   = splitIngStr(g50W[i] || '');

    // Ingredient name: use measure column name ONLY when it was properly parsed
    // (qtyStr != null means a double-space separator was found, so name is clean).
    // If no separator was found in measure column, the raw string became the name
    // (polluted with measure info) — use weight column name instead.
    const name = (meas.qtyStr !== null && meas.name && meas.name !== '-' && meas.name !== 'OR')
      ? meas.name
      : (wt.name && wt.name !== '-' && wt.name !== 'OR' ? wt.name : (meas.name || ''));
    if (!name || name === '-' || name === 'OR') continue;

    // Quantity: prefer measure column, fall back to weight column
    const parsed = (meas.qtyStr ? parseQtyStr(meas.qtyStr) : null)
                ?? (wt.qtyStr   ? parseQtyStr(wt.qtyStr)   : null);
    if (!parsed || parsed.qty == null) continue; // garnish / "to taste" — no measurable qty

    results.push({
      ingredient_name:       name,
      quantity_per_100_svgs: Math.round(parsed.qty * 2 * 1e6) / 1e6, // normalize 50 → 100
      unit: parsed.unit,
    });
  }
  return results;
}

/**
 * Extract per-serving nutrition from the WPRM nutrition label block.
 * Vitamin D is stored in IU on the ICN page; we convert to mcg (÷ 40).
 */
function extractNutrition(html) {
  // Anchor on the ">Calories</div>" element to find the actual rendered block
  // (not the JavaScript code section that also contains class names)
  const calIdx = html.indexOf('">Calories</div>');
  if (calIdx === -1) return {};
  const section = html.slice(Math.max(0, calIdx - 500), calIdx + 15000);

  const calMatch = section.match(/extra-container[^>]*>([\d.]+)/);
  const calories_kcal = calMatch ? parseFloat(calMatch[1]) : null;

  const names  = [...section.matchAll(/nutrient-name[^>]*>([^<]+)<\/div>/g)].map(m => m[1].trim());
  const values = [...section.matchAll(/nutrient-value[^>]*>([\d.]+)<\/div>/g)].map(m => parseFloat(m[1]));
  const units  = [...section.matchAll(/nutrient-unit[^>]*>([^<]+)<\/div>/g)].map(m => m[1].trim());

  const FIELD_MAP = {
    'Total Fat':          'fat_total_g',
    'Saturated Fat':      'sat_fat_g',
    'Sodium':             'sodium_mg',
    'Total Carbohydrate': 'carbohydrate_g',
    'Dietary Fiber':      'fiber_g',
    'Protein':            'protein_g',
    'Vitamin C':          'vitamin_c_mg',
    'Vitamin D':          'vitamin_d_mcg',
    'Calcium':            'calcium_mg',
    'Potassium':          'potassium_mg',
  };

  const result = { calories_kcal };
  const nonCal = names.filter(n => n !== 'Calories');
  for (let i = 0; i < Math.min(nonCal.length, values.length); i++) {
    const field = FIELD_MAP[nonCal[i]];
    if (!field) continue;
    let val = values[i];
    if (nonCal[i] === 'Vitamin D' && units[i] === 'IU') val = val / 40; // IU → mcg
    result[field] = val;
  }
  return result;
}

// ── Page fetcher + parser ─────────────────────────────────────────────────────

async function fetchICNRecipe(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'COA-Menu-Planner-Importer/1.0 (admin@coamenu.org; non-commercial)',
      'Accept':     'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();

  // JSON-LD is the primary structured data source
  const jldMatch = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
  if (!jldMatch) throw new Error(`No JSON-LD found at ${url}`);
  const jld = JSON.parse(jldMatch[1]);

  // Strip the USDA/CACFP suffix from the name
  const name = jld.name
    .replace(/\s*-?\s*USDA Recipe for(?:\s+Adults?\s+in)?\s+CACFP\b.*/i, '')
    .trim();

  // Build instructions string from structured steps
  const instructions = (jld.recipeInstructions || [])
    .map(s => (typeof s === 'string' ? s : s.text))
    .join('\n');

  // Parse serving size in oz from CACFP crediting sentence in description
  // e.g. "½ cup (4 oz spoodle) provides 2 oz equivalent meat"
  const ozMatch   = jld.description?.match(/\((\d+)\s*oz[^)]*spoodle\)/i);
  const serving_size_oz = ozMatch ? parseFloat(ozMatch[1]) : null;
  const utMatch        = jld.description?.match(/\((\d+(?:\s+and\s+\d+)?\s*oz[^)]*spoodle)\)/i);
  const serving_utensil = utMatch ? utMatch[1] : null;

  const ingredients = extractIngredients(jld.recipeIngredient);
  const nutrition   = extractNutrition(html);

  return { name, instructions, ingredients, nutrition, serving_size_oz, serving_utensil };
}

// ── DB insert ─────────────────────────────────────────────────────────────────

async function importRecipe({ url, category, protein_group }) {
  const slug = url.split('/').filter(Boolean).at(-1);
  console.log(`\n▸ ${slug}`);

  const data = await fetchICNRecipe(url);
  const n    = data.nutrition;

  console.log(`  Name: "${data.name}"`);
  console.log(`  Nutrition: cal=${n.calories_kcal} prot=${n.protein_g}g sod=${n.sodium_mg}mg fib=${n.fiber_g}g ca=${n.calcium_mg}mg vitC=${n.vitamin_c_mg}mg K=${n.potassium_mg}mg`);
  console.log(`  Ingredients: ${data.ingredients.length} parsed`);

  // Idempotent — skip if already imported
  const [existing] = await sql`
    SELECT id FROM recipes WHERE name = ${data.name} AND source = 'ICN CACFP'
  `;
  if (existing) {
    console.log(`  ↩ Already exists — skipping`);
    return 'skipped';
  }

  // Insert recipe row
  const [recipe] = await sql`
    INSERT INTO recipes
      (name, category, base_servings, serving_size_oz, serving_utensil,
       instructions, protein_group, seasons, source, is_active)
    VALUES (
      ${data.name},
      ${category},
      50,
      ${data.serving_size_oz},
      ${data.serving_utensil},
      ${data.instructions || null},
      ${protein_group},
      '{}',
      'ICN CACFP',
      true
    )
    RETURNING id
  `;

  // Insert nutrition profile
  await sql`
    INSERT INTO nutrition_profiles
      (recipe_id, calories_kcal, protein_g, carbohydrate_g, fat_total_g, sat_fat_g,
       sodium_mg, fiber_g, calcium_mg, vitamin_d_mcg, vitamin_c_mg, potassium_mg,
       last_calculated_at)
    VALUES (
      ${recipe.id},
      ${n.calories_kcal   ?? null},
      ${n.protein_g       ?? null},
      ${n.carbohydrate_g  ?? null},
      ${n.fat_total_g     ?? null},
      ${n.sat_fat_g       ?? null},
      ${n.sodium_mg       ?? null},
      ${n.fiber_g         ?? null},
      ${n.calcium_mg      ?? null},
      ${n.vitamin_d_mcg   ?? null},
      ${n.vitamin_c_mg    ?? null},
      ${n.potassium_mg    ?? null},
      NOW()
    )
  `;

  // Insert ingredients
  for (const ing of data.ingredients) {
    await sql`
      INSERT INTO recipe_ingredients (recipe_id, ingredient_name, quantity_per_100_svgs, unit)
      VALUES (${recipe.id}, ${ing.ingredient_name}, ${ing.quantity_per_100_svgs}, ${ing.unit})
    `;
  }

  console.log(`  ✓ Imported`);
  return 'imported';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  ICN CACFP Recipe Importer           ║');
  console.log(`║  ${RECIPES.length} recipes from theicn.org         ║`);
  console.log('╚══════════════════════════════════════╝');

  let imported = 0, skipped = 0, failed = 0;

  for (const meta of RECIPES) {
    try {
      const result = await importRecipe(meta);
      if (result === 'skipped') skipped++; else imported++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${err.message}`);
      failed++;
    }
    // Polite delay — don't hammer theicn.org
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log('\n──────────────────────────────────────');
  console.log(`✓ Imported: ${imported}  ↩ Skipped: ${skipped}  ✗ Failed: ${failed}`);
  console.log('──────────────────────────────────────\n');

  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
