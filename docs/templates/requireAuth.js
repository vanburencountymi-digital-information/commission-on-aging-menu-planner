/**
 * Firebase Auth middleware for Cloud Run (Express)
 *
 * Usage:
 *   import { requireAuth } from '../middleware/requireAuth.js';
 *
 *   router.get('/',    requireAuth(),                        handler);  // any logged-in user
 *   router.post('/',   requireAuth('ADMIN'),                 handler);  // ADMIN only → 403 for others
 *   router.delete('/', requireAuth('ADMIN', 'MANAGER'),      handler);  // either role
 *
 * Token flow:
 *   1. Client: const token = await getAuth().currentUser.getIdToken();
 *   2. Client: fetch('/api/...', { headers: { Authorization: `Bearer ${token}` } })
 *   3. This middleware: verifies token with Firebase Admin SDK, attaches decoded claims to req.user
 *
 * Role assignment (run once per user, e.g. in POST /api/users):
 *   import { getAuth } from 'firebase-admin/auth';
 *   await getAuth().setCustomUserClaims(uid, { role: 'ADMIN' });
 *   // User must sign out and back in (or force-refresh token) for claim to appear
 */

import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps } from 'firebase-admin/app';

// Initialize Admin SDK once.
// In Cloud Run: uses the service account attached to the revision automatically.
// Locally: uses GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`.
if (!getApps().length) {
  initializeApp();
}

/**
 * @param {...string} roles - If provided, at least one must match decoded.role.
 *                            If empty, any authenticated user is allowed.
 * @returns Express middleware
 */
export function requireAuth(...roles) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.slice(7);
    try {
      const decoded = await getAuth().verifyIdToken(token);
      req.user = decoded; // { uid, email, role, ... }

      if (roles.length > 0 && !roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      next();
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}
