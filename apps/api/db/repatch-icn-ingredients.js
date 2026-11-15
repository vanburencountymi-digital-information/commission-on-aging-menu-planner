/**
 * ICN CACFP Ingredient Re-patcher
 *
 * Drops and re-imports recipe_ingredients for all ICN CACFP recipes using
 * the improved compound-measure parser. Fixes two bugs from the original import:
 *
 *  1. Ingredient names were polluted with leftover measure text
 *     e.g.  name = "1 qt 2 cups  *Fresh onions, diced"   (wrong)
 *           name = "Fresh onions, diced"                  (correct)
 *
 *  2. Compound measures were truncated to the first unit
 *     e.g.  "3 qt  2 cups  Water"  → stored as 3 qt  (wrong)
 *                                  → stored as 14 cup (correct, ×2 = 28 cup)
 *
 * Re-fetches every ICN page with a 1.2-second polite delay.
 *
 * Run:  node db/repatch-icn-ingredients.js
 */

import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

// ── Unicode fraction map ──────────────────────────────────────────────────────

const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
               '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

const VOL_IN_TBSP = {
  gal: 256, gallon: 256, gallons: 256,
  qt: 64,  quart: 64,  quarts: 64,
  pt: 32,  pint: 32,   pints: 32,
  cup: 16, cups: 16,
  Tbsp: 1, tbsp: 1, tablespoon: 1, tablespoons: 1,
  tsp: 1/3, teaspoon: 1/3, teaspoons: 1/3,
};

// ── Parsing helpers ───────────────────────────────────────────────────────────

function tbspToReadable(totalTbsp) {
  const t = Math.round(totalTbsp * 1e4) / 1e4;
  if (t >= 16)  return { qty: Math.round((t / 16) * 100) / 100, unit: 'cup' };
  if (t >= 3)   return { qty: Math.round(t * 100) / 100, unit: 'Tbsp' };
  const tspVal = Math.round(t * 3 * 100) / 100;
  if (Math.abs(tspVal - Math.round(tspVal)) < 0.01) return { qty: Math.round(tspVal), unit: 'tsp' };
  return t >= 1
    ? { qty: Math.round(t * 100) / 100, unit: 'Tbsp' }
    : { qty: tspVal, unit: 'tsp' };
}

function normFracs(s) {
  for (const [frac, val] of Object.entries(FRAC)) {
    s = s.replace(new RegExp(`(\\d)${frac}`, 'g'), (_, d) => String(parseFloat(d) + val));
    s = s.replace(new RegExp(frac, 'g'), String(val));
  }
  return s;
}

function splitIngStr(s) {
  s = s.trim();
  if (!s || s === '-' || s.startsWith('- ')) {
    return { qtyStr: null, name: s.replace(/^-\s*-?\s*/, '').trim() };
  }
  const m = s.match(/^([\s\S]*\S)\s{2,}(\S[\s\S]*)$/);
  if (!m) return { qtyStr: null, name: s };
  // Strip leading parenthetical notes from the name:
  //   "(approx. 2 No. 10 cans) Canned beans…" → "Canned beans…"
  const name = m[2].trim().replace(/^\([^)]*\)\s*/, '').trim();
  return { qtyStr: m[1].trim(), name };
}

function parseQtyStr(qtyStr) {
  if (!qtyStr) return null;
  // Strip parenthetical notes like "(approx. ½ No. 10 can)" — kitchen hints, not measures
  const s = normFracs(qtyStr.trim()).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  const tokens = [];
  const rx = /(\d+(?:\.\d+)?)\s+([a-zA-Z]+)/g;
  let m;
  while ((m = rx.exec(s)) !== null) {
    tokens.push({ qty: parseFloat(m[1]), unit: m[2] });
  }
  if (tokens.length === 0) {
    const bare = parseFloat(s);
    return isNaN(bare) ? null : { qty: bare, unit: '' };
  }
  if (tokens.length === 1) return tokens[0];

  // Compound weight: lb + oz
  if (tokens.length === 2 &&
      /^lbs?$/i.test(tokens[0].unit) &&
      /^oz$/i.test(tokens[1].unit)) {
    return { qty: tokens[0].qty + tokens[1].qty / 16, unit: 'lb' };
  }

  // Compound volume: sum in Tbsp
  let totalTbsp = 0;
  let allVol = true;
  for (const { qty, unit } of tokens) {
    const factor = VOL_IN_TBSP[unit] ?? VOL_IN_TBSP[unit.toLowerCase()];
    if (factor == null) { allVol = false; break; }
    totalTbsp += qty * factor;
  }
  if (allVol) return tbspToReadable(totalTbsp);

  return tokens[0];
}

function extractIngredients(ingArray) {
  if (!ingArray?.length || ingArray.length % 4 !== 0) return [];
  const n = ingArray.length / 4;
  const g50W = ingArray.slice(n * 2, n * 3);
  const g50M = ingArray.slice(n * 3, n * 4);

  const results = [];
  for (let i = 0; i < n; i++) {
    const meas = splitIngStr(g50M[i] || '');
    const wt   = splitIngStr(g50W[i] || '');

    // Use measure column name only when properly parsed (clean double-space split).
    // When no separator was found, the raw string became meas.name (polluted with
    // measure text like "1 qt Canned green chilies") — fall back to weight name.
    const name = (meas.qtyStr !== null && meas.name && meas.name !== '-' && meas.name !== 'OR')
      ? meas.name
      : (wt.name && wt.name !== '-' && wt.name !== 'OR' ? wt.name : (meas.name || ''));
    if (!name || name === '-' || name === 'OR') continue;

    const parsed = (meas.qtyStr ? parseQtyStr(meas.qtyStr) : null)
                ?? (wt.qtyStr   ? parseQtyStr(wt.qtyStr)   : null);
    if (!parsed || parsed.qty == null) continue;

    results.push({
      ingredient_name:       name,
      quantity_per_100_svgs: Math.round(parsed.qty * 2 * 1e6) / 1e6,
      unit: parsed.unit,
    });
  }
  return results;
}

// ── URL → recipe manifest ─────────────────────────────────────────────────────

const RECIPES = [
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-sandwiches/asian-tuna-burgers-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-sandwiches/jerk-fish-wrap-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-salads/barbecue-chicken-or-turkey-salad-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/bean-burrito-bowl-vegetable-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-soup/bean-soup-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-soup/beef-vegetable-soup-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/chicken-fajita-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/chicken-or-turkey-noodles-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/cuban-black-beans-and-rice-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/green-beans-with-potatoes-and-smoked-turkey-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/ground-turkey-and-beef-spanish-rice-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/honey-lime-chicken-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/hoppin-john-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/macaroni-and-cheese-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-vegetables/baked-beans-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/baked-sweet-potatoes-with-apples-usda-recipe-for-adults-in-cacfp/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/brown-rice-pilaf-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-salads/carrot-raisin-salad-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/corn-and-edamame-blend-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/corn-pudding-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/creamy-coleslaw-usda-recipe-for-adults-in-cacfp/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/local-harvest-bake-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-salads/macaroni-salad-usda-recipe-for-cacfp-adult/',
  'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-salads/marinated-black-bean-salad-usda-recipe-for-cacfp-adult/',
];

// ── Fetch + parse one ICN page ────────────────────────────────────────────────

async function fetchIngredients(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'COA-Menu-Planner-Repatcher/1.0 (admin@coamenu.org; non-commercial)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const jldMatch = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
  if (!jldMatch) throw new Error('No JSON-LD found');

  const jld = JSON.parse(jldMatch[1]);
  const recipeName = jld.name
    .replace(/\s*-?\s*USDA Recipe for(?:\s+Adults?\s+in)?\s+CACFP\b.*/i, '')
    .trim();

  return {
    name: recipeName,
    ingredients: extractIngredients(jld.recipeIngredient),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  ICN CACFP Ingredient Re-patcher                 ║');
  console.log('║  Drops and re-imports all ICN recipe ingredients ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let ok = 0, failed = 0;

  for (const url of RECIPES) {
    const slug = url.split('/').filter(Boolean).at(-1);
    process.stdout.write(`▸ ${slug.substring(0, 55).padEnd(55)}`);

    try {
      const { name, ingredients } = await fetchIngredients(url);

      // Find the recipe row
      const [recipe] = await sql`
        SELECT id FROM recipes WHERE name = ${name} AND source = 'ICN CACFP'
      `;
      if (!recipe) {
        console.log(` SKIP (not in DB — run import:icn first)`);
        continue;
      }

      // Drop existing ingredients
      await sql`DELETE FROM recipe_ingredients WHERE recipe_id = ${recipe.id}`;

      // Re-insert with corrected parsing
      if (ingredients.length > 0) {
        const rows = ingredients.map(ing => ({
          recipe_id:             recipe.id,
          ingredient_name:       ing.ingredient_name,
          quantity_per_100_svgs: ing.quantity_per_100_svgs,
          unit:                  ing.unit,
        }));
        await sql`INSERT INTO recipe_ingredients ${sql(rows)}`;
      }

      console.log(` ✓ ${ingredients.length} ingredients`);
      ok++;
    } catch (err) {
      console.log(` ✗ ${err.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`✓ Updated: ${ok}   ✗ Failed: ${failed}`);
  console.log('──────────────────────────────────────────────────\n');

  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
