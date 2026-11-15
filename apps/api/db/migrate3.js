// Runs migration 003 — creates usda_cache table.
// Run: node db/migrate3.js  (from apps/api/, with proxy running on 5433)
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const file = join(__dirname, 'migrations', '003_usda_cache.sql');
console.log('Running migration: 003_usda_cache.sql');
try {
  await sql.unsafe(readFileSync(file, 'utf8'));
  console.log('Migration 003 complete.');
} catch (err) {
  console.error('Migration 003 failed:', err.message);
  process.exit(1);
} finally {
  await sql.end();
}
