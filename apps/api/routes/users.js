import { Router } from 'express';
import argon2 from 'argon2';
import sql from '../db/client.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// GET /api/users  [ADMIN]
router.get('/', requireAuth('ADMIN'), async (req, res) => {
  try {
    const users = await sql`
      SELECT id, email, name, role, is_active, created_at
      FROM users
      ORDER BY created_at DESC
    `;
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users  [ADMIN]
// Body: { name, email, role, password }
router.post('/', requireAuth('ADMIN'), async (req, res) => {
  try {
    const { name, email, role, password } = req.body;
    if (!name || !email || !role || !password) {
      return res.status(400).json({ error: 'name, email, role, and password are required' });
    }
    const VALID_ROLES = ['ADMIN', 'NUTRITION_MANAGER', 'DIETITIAN', 'KITCHEN_STAFF'];
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const hashed = await argon2.hash(password);
    const [user] = await sql`
      INSERT INTO users (name, email, role, hashed_password)
      VALUES (${name}, ${email.toLowerCase().trim()}, ${role}, ${hashed})
      RETURNING id, email, name, role, is_active, created_at
    `;
    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PATCH /api/users/:id  [ADMIN]
// Body: { name?, role?, is_active?, password? }
router.patch('/:id', requireAuth('ADMIN'), async (req, res) => {
  try {
    const { name, role, is_active, password } = req.body;

    // Prevent admin from deactivating themselves
    if (req.params.id === req.user.id && is_active === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    let hashedPassword = null;
    if (password) {
      hashedPassword = await argon2.hash(password);
    }

    const [user] = await sql`
      UPDATE users SET
        name           = COALESCE(${name        ?? null}, name),
        role           = COALESCE(${role        ?? null}::user_role, role),
        is_active      = COALESCE(${is_active   ?? null}, is_active),
        hashed_password = COALESCE(${hashedPassword ?? null}, hashed_password)
      WHERE id = ${req.params.id}
      RETURNING id, email, name, role, is_active, created_at
    `;
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

export default router;
