// Seed/refresh the role accounts. Run: node db/seeds/002_users.js  (from apps/api/ with DATABASE_URL set)
//
// Passwords:
//   SEED_PASSWORD=<value>   every account gets that password (local dev only)
//   (unset)                 each account gets its own random password
//
// Generated passwords are written to SEED_CREDENTIALS_FILE if set, otherwise
// printed once to stdout. They are never stored anywhere else — note them down.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { hash, argon2id } from 'argon2';
import sql from '../client.js';

const users = [
  { email: 'admin@sjccoa.org',     name: 'Admin User',        role: 'ADMIN' },
  { email: 'nutrition@sjccoa.org', name: 'Nutrition Manager', role: 'NUTRITION_MANAGER' },
  { email: 'dietitian@sjccoa.org', name: 'Dietitian',         role: 'DIETITIAN' },
  { email: 'kitchen@sjccoa.org',   name: 'Kitchen Staff',     role: 'KITCHEN_STAFF' },
];

const sharedPassword = process.env.SEED_PASSWORD;
const credentials = [];

for (const user of users) {
  const password = sharedPassword ?? randomBytes(12).toString('base64url');
  const hashed_password = await hash(password, { type: argon2id });
  await sql`
    INSERT INTO users (email, name, hashed_password, role)
    VALUES (${user.email}, ${user.name}, ${hashed_password}, ${user.role}::user_role)
    ON CONFLICT (email) DO UPDATE
      SET hashed_password = EXCLUDED.hashed_password,
          name            = EXCLUDED.name,
          role            = EXCLUDED.role
  `;
  credentials.push(`${user.email}\t${user.role}\t${password}`);
  console.log(`Seeded ${user.email} (${user.role})`);
}

await sql.end();

if (!sharedPassword) {
  const body = credentials.join('\n') + '\n';
  if (process.env.SEED_CREDENTIALS_FILE) {
    writeFileSync(process.env.SEED_CREDENTIALS_FILE, body, { mode: 0o600 });
    console.log(`Generated credentials written to ${process.env.SEED_CREDENTIALS_FILE}`);
  } else {
    console.log('\nGenerated credentials (shown once):\n' + body);
  }
}
console.log('User seed complete.');
