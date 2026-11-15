import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

async function migrate() {
  const migrationFile = join(__dirname, 'migrations', '001_initial_schema.sql');
  const migrationSQL = readFileSync(migrationFile, 'utf8');

  console.log('Running migration: 001_initial_schema.sql');
  try {
    await sql.unsafe(migrationSQL);
    console.log('Migration complete.');
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('Schema already exists — skipping.');
    } else {
      console.error('Migration failed:', err.message);
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

migrate();
