// Runs migration 002 — add is_active to users, add holiday fields to menu_days.
// Run: node db/migrate2.js  (from apps/api/, with proxy running on 5433)
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const file = join(__dirname, 'migrations', '002_add_user_active_holiday_fields.sql');
console.log('Running migration: 002_add_user_active_holiday_fields.sql');
try {
  await sql.unsafe(readFileSync(file, 'utf8'));
  console.log('Migration 002 complete.');
} catch (err) {
  console.error('Migration 002 failed:', err.message);
  process.exit(1);
} finally {
  await sql.end();
}
