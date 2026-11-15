/**
 * ICN CACFP Recipe Field Patcher
 *
 * Fills in cooking_temp_f, internal_temp_f, and serving_size_oz for the 24
 * ICN CACFP recipes imported by import-icn.js, using two strategies:
 *
 *  1. Extract temps and some serving sizes from the instructions already in DB
 *     (no HTTP requests needed for this pass).
 *
 *  2. Re-fetch ICN pages for recipes still missing serving_size_oz, using
 *     improved patterns that cover bowls, ladles, cups, and wraps.
 *
 * Run:  node db/patch-icn-fields.js
 */

import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

// ── Temp extraction from stored instructions ──────────────────────────────────

/**
 * Conventional oven temp — first occurrence of "Conventional oven: 400 °F"
 * or "Conventional: 400 °F" or "Preheat oven to 400 °F".
 */
function extractCookingTemp(instructions) {
  if (!instructions) return null;
  const m = instructions.match(/Conventional(?:\s+oven)?:?\s*(\d{3})\s*°F/i)
         ?? instructions.match(/Preheat oven to (\d{3})\s*°F/i)
         ?? instructions.match(/Bake.*?(\d{3})\s*°F/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Internal (food-safety) temperature — from the CCP step.
 * "Critical Control Point: Heat to 165 °F or higher for at least 15 seconds"
 */
function extractInternalTemp(instructions) {
  if (!instructions) return null;
  const m = instructions.match(/Heat to (\d{3})\s*°F/i)
         ?? instructions.match(/(\d{3})\s*°F\s+or\s+higher/i)
         ?? instructions.match(/internal temperature of (\d{3})\s*°F/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Serving size from instructions — scan for common patterns in the Serve step.
 * e.g. "Serve 1 - 24 oz burrito bowl"  →  24
 *      "Serve 1 cup (8 oz ladle)"       →  8
 *      "Serve ½ cup (4 oz spoodle)"     →  4
 *      "Use a No.8 scoop (4 oz)"        →  4
 */
function extractServingSizeFromInstructions(instructions) {
  if (!instructions) return null;
  // "Serve X - Y oz ..."
  const bowlM = instructions.match(/Serve\s+\d+\s*-\s*(\d+)\s*oz/i);
  if (bowlM) return parseFloat(bowlM[1]);
  // "(X oz spoodle/ladle/scoop)" anywhere in a Serve step line
  const lines = instructions.split('\n');
  for (const line of lines) {
    if (/serve|portion/i.test(line)) {
      const m = line.match(/\((\d+(?:\.\d+)?)\s*oz[^)]*(?:spoodle|ladle|scoop|bowl|cup)[^)]*\)/i)
             ?? line.match(/(\d+(?:\.\d+)?)\s*oz[^,.\n]*(?:spoodle|ladle|scoop)/i);
      if (m) return parseFloat(m[1]);
    }
  }
  return null;
}

// ── Re-fetch improved serving_size from ICN page ──────────────────────────────

async function fetchServingSize(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'COA-Menu-Planner-Patcher/1.0', 'Accept': 'text/html' },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const jldMatch = html.match(/<script[^>]+ld\+json[^>]*>([\s\S]*?)<\/script>/);
    if (!jldMatch) return null;
    const desc = JSON.parse(jldMatch[1])?.description ?? '';

    // "Serve 1 - 24 oz burrito bowl" or "(24 oz) bowl"
    const patterns = [
      /Serve\s+\d+\s*-\s*(\d+)\s*oz/i,             // "Serve 1 - 24 oz bowl"
      /One\s*\((\d+)\s*oz\)/i,                       // "One (24 oz) bowl"
      /\((\d+)\s*oz[^)]*spoodle\)/i,                 // "(8 oz spoodle)"
      /\((\d+)\s*oz[^)]*ladle\)/i,                   // "(8 oz ladle)"
      /\((\d+)\s*oz[^)]*scoop\)/i,                   // "(4 oz scoop)"
      /\((\d+)\s*oz[^)]*cup\)/i,                     // "(8 oz cup)"
      /\((\d+(?:\.\d+)?)\s*oz\)/i,                   // "(6 oz)" any generic
    ];
    for (const pat of patterns) {
      const m = desc.match(pat) ?? html.slice(0, 50000).match(pat);
      if (m) return parseFloat(m[1]);
    }
    return null;
  } catch {
    return null;
  }
}

// ── Source URL lookup ─────────────────────────────────────────────────────────
// Reconstruct ICN URL from recipe name slug pattern stored in import-icn.js.
// We'll use a fallback approach: build the URL from the recipe's stored source_url
// (not stored) or re-derive it. Since we don't store the URL, we'll use a
// name→URL map for the recipes still missing serving_size_oz.

const NAME_TO_URL = {
  'Asian Tuna Burgers':                       'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-sandwiches/asian-tuna-burgers-usda-recipe-for-cacfp-adult/',
  'Jerk Fish Wrap':                           'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-sandwiches/jerk-fish-wrap-usda-recipe-for-cacfp-adult/',
  'Bean Burrito Bowl (Vegetable)':            'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/bean-burrito-bowl-vegetable-usda-recipe-for-cacfp-adult/',
  'Bean Soup':                                'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-soup/bean-soup-usda-recipe-for-cacfp-adult/',
  'Beef Vegetable Soup':                      'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-soup/beef-vegetable-soup-usda-recipe-for-cacfp-adult/',
  'Chicken Fajita':                           'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/chicken-fajita-usda-recipe-for-cacfp-adult/',
  'Cuban Black Beans and Rice':               'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/cuban-black-beans-and-rice-usda-recipe-for-cacfp-adult/',
  'Ground Turkey and Beef Spanish Rice':      'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/ground-turkey-and-beef-spanish-rice-usda-recipe-for-cacfp-adult/',
  'Macaroni and Cheese':                      'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-main-dishes/macaroni-and-cheese-usda-recipe-for-cacfp-adult/',
  'Corn Pudding':                             'https://theicn.org/cnrb/cacfp-adult-portion/cacfp-adult-portion-side-dish/corn-pudding-usda-recipe-for-cacfp-adult/',
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const recipes = await sql`
    SELECT id, name, instructions, serving_size_oz, cooking_temp_f, internal_temp_f
    FROM recipes WHERE source = 'ICN CACFP' ORDER BY name
  `;

  console.log(`\nPatching ${recipes.length} ICN CACFP recipes...\n`);

  for (const r of recipes) {
    const updates = {};

    // ── Temps from stored instructions (fast, no HTTP) ──
    if (r.cooking_temp_f == null) {
      const t = extractCookingTemp(r.instructions);
      if (t) updates.cooking_temp_f = t;
    }
    if (r.internal_temp_f == null) {
      const t = extractInternalTemp(r.instructions);
      if (t) updates.internal_temp_f = t;
    }

    // ── Serving size — instructions first, then re-fetch if still missing ──
    if (r.serving_size_oz == null) {
      const fromInstr = extractServingSizeFromInstructions(r.instructions);
      if (fromInstr) {
        updates.serving_size_oz = fromInstr;
      } else {
        const url = NAME_TO_URL[r.name];
        if (url) {
          process.stdout.write(`  Fetching serving size for "${r.name}"... `);
          const oz = await fetchServingSize(url);
          if (oz) {
            updates.serving_size_oz = oz;
            console.log(`${oz} oz`);
          } else {
            console.log('not found');
          }
          await new Promise(res => setTimeout(res, 1000));
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      console.log(`  ✓ ${r.name.substring(0, 45)} — already complete`);
      continue;
    }

    await sql`
      UPDATE recipes SET
        cooking_temp_f  = COALESCE(${updates.cooking_temp_f  ?? null}, cooking_temp_f),
        internal_temp_f = COALESCE(${updates.internal_temp_f ?? null}, internal_temp_f),
        serving_size_oz = COALESCE(${updates.serving_size_oz ?? null}, serving_size_oz)
      WHERE id = ${r.id}
    `;

    const summary = Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`  ✓ ${r.name.substring(0, 45).padEnd(46)} → ${summary}`);
  }

  console.log('\nDone.\n');
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
