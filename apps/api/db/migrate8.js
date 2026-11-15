import 'dotenv/config';
import sql from './client.js';

console.log('Running migration 008 — client_narrative column...');
await sql`ALTER TABLE menus ADD COLUMN IF NOT EXISTS client_narrative TEXT`;
console.log('Migration 008 complete.');
await sql.end();
