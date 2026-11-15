import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sql from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(__dirname, 'migrations/004_approval_fields.sql'), 'utf8');

await sql.unsafe(migration);
console.log('Migration 004 applied.');
await sql.end();
