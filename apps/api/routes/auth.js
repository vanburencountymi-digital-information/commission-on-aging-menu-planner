import { Router } from 'express';
import { verify } from 'argon2';
import sql from '../db/client.js';
import { lucia } from '../auth/lucia.js';
import { loginIpLimiter, loginEmailLimiter } from '../middleware/rateLimits.js';

const router = Router();

// POST /api/auth/login
// Body: { email, password }. Returns session cookie + user object.
// Failed attempts are rate-limited per IP and per account (see middleware/rateLimits.js).
router.post('/login', loginIpLimiter, loginEmailLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const [user] = await sql`
      SELECT * FROM users
      WHERE email = ${email.toLowerCase().trim()} AND is_active = true
    `;
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await verify(user.hashed_password, password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const session = await lucia.createSession(user.id, {});
    const cookie = lucia.createSessionCookie(session.id);
    res.setHeader('Set-Cookie', cookie.serialize());
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
// Invalidates session and clears cookie.
router.post('/logout', async (req, res) => {
  try {
    const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
    if (sessionId) await lucia.invalidateSession(sessionId);
    res.setHeader('Set-Cookie', lucia.createBlankSessionCookie().serialize());
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/auth/me
// Returns current user from session, or 401.
router.get('/me', async (req, res) => {
  try {
    const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
    if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });

    const { user, session } = await lucia.validateSession(sessionId);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });

    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get current user' });
  }
});

export default router;
