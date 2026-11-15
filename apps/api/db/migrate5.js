import 'dotenv/config';
import sql from './client.js';

// ALTER TYPE ADD VALUE cannot run inside a transaction — execute each statement separately.
try {
  await sql`ALTER TYPE meal_type ADD VALUE IF NOT EXISTS 'SIDE'`;
  await sql`ALTER TYPE meal_type ADD VALUE IF NOT EXISTS 'FRUIT'`;
  await sql`ALTER TYPE meal_type ADD VALUE IF NOT EXISTS 'BREAD'`;
  await sql`ALTER TYPE meal_type ADD VALUE IF NOT EXISTS 'DESSERT'`;
  console.log('Migration 005 applied — meal_type enum extended with SIDE, FRUIT, BREAD, DESSERT.');
} catch (err) {
  console.error('Migration 005 failed:', err.message);
  process.exit(1);
} finally {
  await sql.end();
}
