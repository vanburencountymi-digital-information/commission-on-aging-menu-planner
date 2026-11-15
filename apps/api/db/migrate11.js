// Migration 011 — Replace test-data recipes with the first CBORD NetMenu
// import batch (68 recipes parsed from 3 PDFs on 2026-05-26).
//
// Strategy:
//   1. UPDATE existing recipes SET is_active = false. This hides the test
//      placeholders from recipe pickers without breaking FK references from
//      menu_day_items / menu_proposals / etc. — past test menus stay intact
//      historically. (Hard-DELETE would cascade or fail on those FKs.)
//   2. INSERT the 68 new recipes + their ingredients in a single transaction.
//      Source-tagged "CBORD NetMenu Import 2026-05-26" for traceability.
//
// Ingredients flagged needs_review by the parser (37/329 in this batch) are
// inserted with quantity_per_100_svgs = 1, unit = 'each', and the original
// raw text appended to ingredient_name in brackets so a Nutrition Manager
// can find and fix them in the recipe editor.
//
// To re-run: this is idempotent only if the new recipes don't yet exist —
// running twice will create duplicates. Drake should run once on staging
// after confirming the deactivation behavior is desired.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, 'seeds', '002_cbord_imports.json');
const SOURCE_LABEL = 'CBORD NetMenu Import 2026-05-26';

console.log('Running migration 011 — CBORD recipe import...');
console.log(`Reading parsed recipes from ${SEED_PATH}`);

const recipes = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
console.log(`Parsed ${recipes.length} recipes to import`);

const totalIngs = recipes.reduce((n, r) => n + r.ingredients.length, 0);
const reviewIngs = recipes.reduce(
  (n, r) => n + r.ingredients.filter(i => i.needs_review).length,
  0,
);
console.log(`  ${totalIngs} ingredients (${reviewIngs} flagged for review)`);

await sql.begin(async tx => {
  // 1. Deactivate the existing placeholder/test recipes. They stay in the DB
  //    so menu_day_items still resolve (test menus remain viewable) — they
  //    just stop appearing in active recipe lists.
  const deactivateResult = await tx`
    UPDATE recipes SET is_active = false, updated_at = NOW()
    WHERE is_active = true
  `;
  console.log(`  Deactivated ${deactivateResult.count} existing recipes`);

  // 2. Insert the new recipes one-by-one, then their ingredients.
  let inserted = 0;
  for (const r of recipes) {
    const [row] = await tx`
      INSERT INTO recipes (
        name, category, base_servings, serving_utensil, instructions,
        source, is_active, seasons
      ) VALUES (
        ${r.name},
        ${r.category}::recipe_category,
        ${r.yield_qty ?? 100},
        ${r.serving_utensil ?? null},
        ${(r.instructions ?? []).join('\n') || null},
        ${SOURCE_LABEL},
        TRUE,
        '{}'
      )
      RETURNING id
    `;

    const recipeId = row.id;

    for (const ing of r.ingredients) {
      // Decide what to write. Parseable ingredient → clean fields. Otherwise
      // park the raw text inside the name so the NM can fix it in the editor.
      const needsReview = ing.needs_review || ing.qty_value == null;
      let name;
      let qty;
      let unit;
      if (needsReview) {
        const raw = ing.raw_qty ? ` [needs review: ${ing.raw_qty}]` : ' [needs review]';
        name = (ing.name || '(unnamed)') + raw;
        qty = 1;
        unit = 'each';
      } else {
        name = ing.name;
        qty = Number(ing.qty_value);
        unit = ing.unit || 'each';
      }

      await tx`
        INSERT INTO recipe_ingredients (
          recipe_id, ingredient_name, quantity_per_100_svgs, unit
        ) VALUES (
          ${recipeId}, ${name}, ${qty}, ${unit}
        )
      `;
    }

    inserted += 1;
  }

  console.log(`  Inserted ${inserted} recipes + ${totalIngs} ingredients`);
});

console.log('Migration 011 complete.');
console.log('');
console.log('Next steps (manual, in the app):');
console.log('  1. Open the Recipes screen and verify the new recipes appear.');
console.log('  2. Walk the recipe list and fix any [needs review] ingredients.');
console.log('  3. Run "Recalc Nutrition" on each recipe once USDA links are in place');
console.log('     (DIC-95 USDA auto-link can be run against this batch).');
console.log('  4. If you want the old placeholder recipes permanently gone:');
console.log('     DELETE FROM recipes WHERE is_active = false AND source IS NULL;');
console.log('     (skipped here so test menus stay viewable.)');

await sql.end();
