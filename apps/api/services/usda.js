import sql from '../db/client.js';

const BASE = 'https://api.nal.usda.gov/fdc/v1';

// USDA FDC nutrient ID → column name (used by batch POST /foods response)
const NUTRIENT_ID_MAP = {
  1008: 'calories_kcal',
  2048: 'calories_kcal',  // Foundation Foods alternate energy ID
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

// USDA nutrient number (string) → column name (used by single GET /food response)
// These are the classic USDA nutrient numbers, different from FDC internal IDs.
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

// Keep for batch POST request parameter (IDs that matter, deduped)
const NUTRIENT_IDS = [1008, 2048, 1003, 1004, 1005, 1079, 1093, 1087, 1162, 1114, 1092, 1258];

// Backward-compat alias
const NUTRIENT_MAP = NUTRIENT_ID_MAP;

function apiKey() { return process.env.USDA_API_KEY; }

function extractNutrients(food) {
  const result = {};
  for (const fn of food.foodNutrients ?? []) {
    // Single GET abridged → items have { number, name, amount }
    // Batch POST abridged → items have { nutrientId, value } or { nutrient: { id }, amount }
    const col = NUTRIENT_NUMBER_MAP[fn.number]
             ?? NUTRIENT_ID_MAP[fn.nutrientId]
             ?? NUTRIENT_ID_MAP[fn.nutrient?.id];
    if (col && !result[col]) result[col] = fn.amount ?? fn.value ?? 0;
  }
  return result;
}

async function fromCache(fdcId) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [row] = await sql`
    SELECT nutrients FROM usda_cache
    WHERE fdc_id = ${fdcId} AND fetched_at > ${cutoff.toISOString()}
  `;
  return row ? row.nutrients : null;
}

async function toCache(fdcId, nutrients) {
  // Pass the object directly — postgres.js encodes it as JSON for the
  // ::jsonb cast. Do NOT wrap with JSON.stringify(): the driver also encodes
  // strings, producing a double-encoded JSONB *string* like `"{}"` instead
  // of the empty object `{}`. Every prior cache row was corrupted this way
  // (see DIC-176); migrate12.js clears them.
  await sql`
    INSERT INTO usda_cache (fdc_id, nutrients, fetched_at)
    VALUES (${fdcId}, ${nutrients}::jsonb, NOW())
    ON CONFLICT (fdc_id) DO UPDATE
      SET nutrients = EXCLUDED.nutrients, fetched_at = EXCLUDED.fetched_at
  `;
}

// Search USDA FoodData Central by keyword. Returns top 10 results.
export async function searchFoods(query) {
  const url = `${BASE}/foods/search?api_key=${apiKey()}`
    + `&query=${encodeURIComponent(query)}&pageSize=10`
    + `&nutrients=${NUTRIENT_IDS.join(',')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USDA search failed: ${res.status}`);
  const data = await res.json();
  return (data.foods ?? []).map(f => ({
    fdcId: f.fdcId,
    description: f.description,
    dataType: f.dataType,
    brandOwner: f.brandOwner ?? null,
  }));
}

// Get nutrients per 100g for a single food. Uses 7-day cache.
export async function getFoodNutrients(fdcId) {
  const cached = await fromCache(fdcId);
  if (cached) return cached;

  // Note: do NOT add &nutrients= filter here — it silently returns empty
  // foodNutrients for Foundation Foods. Fetch all and filter in extractNutrients.
  const url = `${BASE}/food/${fdcId}?format=abridged&api_key=${apiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USDA food fetch failed: ${res.status}`);
  const data = await res.json();
  const nutrients = extractNutrients(data);
  await toCache(fdcId, nutrients);
  return nutrients;
}

// Batch fetch nutrients for multiple FDC IDs (max 20/request). Checks cache first.
export async function getFoodNutrientsBatch(fdcIds) {
  const result = {};
  const uncached = [];

  for (const id of fdcIds) {
    const cached = await fromCache(id);
    if (cached) result[id] = cached;
    else uncached.push(id);
  }

  for (let i = 0; i < uncached.length; i += 20) {
    const chunk = uncached.slice(i, i + 20);
    const res = await fetch(`${BASE}/foods?api_key=${apiKey()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Do NOT add `nutrients: NUTRIENT_IDS` to the body — same trap as the
      // single GET path above. The filter silently returns empty
      // foodNutrients[] for Foundation Foods, causing every nutrient to
      // resolve to 0 downstream. Fetch all and filter in extractNutrients.
      body: JSON.stringify({ fdcIds: chunk, format: 'abridged' }),
    });
    if (!res.ok) throw new Error(`USDA batch fetch failed: ${res.status}`);
    const foods = await res.json();
    for (const food of foods) {
      const nutrients = extractNutrients(food);
      await toCache(food.fdcId, nutrients);
      result[food.fdcId] = nutrients;
    }
  }

  return result;
}
