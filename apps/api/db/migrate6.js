import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const migrationSQL = readFileSync(join(__dirname, 'migrations', '006_planning_notes.sql'), 'utf8');

console.log('Running migration 006: add planning_notes to menus…');
try {
  await sql.unsafe(migrationSQL);
  console.log('Migration 006 complete.');
} catch (err) {
  console.error('Migration 006 failed:', err.message);
  process.exit(1);
} finally {
  await sql.end();
}
