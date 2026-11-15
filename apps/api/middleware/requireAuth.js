import { lucia } from '../auth/lucia.js';

// requireAuth(...roles) validates session cookie and checks role, then attaches user to req.user.
// Pass no roles to require any authenticated user.
// Pass role strings to restrict access (e.g. 'ADMIN', 'NUTRITION_MANAGER').
export function requireAuth(...roles) {
  return async (req, res, next) => {
    try {
      const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
      if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });

      const { user, session } = await lucia.validateSession(sessionId);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      if (roles.length > 0 && !roles.includes(user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user = user;
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Auth check failed' });
    }
  };
}
