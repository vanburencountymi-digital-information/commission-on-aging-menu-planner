// Migration 012 — clear corrupt USDA cache entries.
//
// Background: there were TWO bugs in the USDA fetch/cache layer (see DIC-176):
//
//   1. `getFoodNutrientsBatch` sent `nutrients: NUTRIENT_IDS` in the batch
//      POST body. USDA's API silently returns empty `foodNutrients` for
//      Foundation Foods when that filter is present. extractNutrients then
//      returned {}.
//
//   2. `toCache` wrapped the value with `JSON.stringify(nutrients)` and then
//      cast to ::jsonb. postgres.js also encodes strings as JSON, so the
//      cache stored JSONB *strings* (e.g. `"{}"` — a string, not an empty
//      object) rather than the objects we expected. Every cached row was
//      therefore unusable by `calculateNutrition`, which reads
//      `nutrientMap[id][key]` and gets `undefined` from a string.
//
// Both bugs are now fixed in services/usda.js. This migration purges every
// row whose `nutrients` value isn't a real JSONB object — that's all 20
// pre-existing rows in staging at the time of writing. Next Recalc per
// recipe re-fetches and stores the correct shape.
//
// Idempotent. Safe to re-run.

import 'dotenv/config';
import sql from './client.js';

console.log('Running migration 012 — clear corrupt USDA cache entries...');

const [{ total_before }] = await sql`SELECT COUNT(*)::int AS total_before FROM usda_cache`;
const [{ object_before }] = await sql`
  SELECT COUNT(*)::int AS object_before FROM usda_cache
  WHERE jsonb_typeof(nutrients) = 'object' AND nutrients <> '{}'::jsonb
`;
console.log(`  Before: ${total_before} total rows, ${object_before} look like valid non-empty objects`);

const result = await sql`
  DELETE FROM usda_cache
  WHERE jsonb_typeof(nutrients) <> 'object'
     OR nutrients = '{}'::jsonb
     OR nutrients IS NULL
`;
console.log(`  Deleted ${result.count} corrupt or empty rows`);

const [{ total_after }] = await sql`SELECT COUNT(*)::int AS total_after FROM usda_cache`;
console.log(`  After: ${total_after} valid rows remain`);

console.log('Migration 012 complete.');
console.log('');
console.log('After this runs, click "Recalc Nutrition" on any recipe whose');
console.log('per-serving values showed as 0. The cache miss triggers a fresh');
console.log('USDA fetch (without the broken filter) and the correct object');
console.log('encoding now writes a real JSONB object.');

await sql.end();
