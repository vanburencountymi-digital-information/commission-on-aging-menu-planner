import 'dotenv/config';
import sql from './client.js';

console.log('Running migration 009 — ingredient ordering fields + estimated_servings...');

await sql`ALTER TABLE menu_days ADD COLUMN IF NOT EXISTS estimated_servings INTEGER`;

await sql`
  ALTER TABLE recipe_ingredients
    ADD COLUMN IF NOT EXISTS vendor           TEXT DEFAULT 'GFS',
    ADD COLUMN IF NOT EXISTS gfs_product_code TEXT,
    ADD COLUMN IF NOT EXISTS case_size        TEXT,
    ADD COLUMN IF NOT EXISTS order_unit       TEXT
`;

console.log('Migration 009 complete.');
await sql.end();
