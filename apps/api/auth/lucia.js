import { Lucia, TimeSpan } from 'lucia';
import { PostgresJsAdapter } from '@lucia-auth/adapter-postgresql';
import sql from '../db/client.js';

// NOTE: lucia v3 and @lucia-auth/adapter-postgresql are deprecated upstream.
// The Lucia project recommends a DIY session layer for new projects.
// Migrating away from Lucia is tracked for M2 if it causes issues — spec calls for it in M1.

const adapter = new PostgresJsAdapter(sql, {
  user: 'users',
  session: 'sessions',
});

export const lucia = new Lucia(adapter, {
  sessionExpiresIn: new TimeSpan(30, 'd'),
  sessionCookie: {
    // The SPA and API are served from the same origin, so a Lax cookie is enough.
    // Secure everywhere except local dev over plain http.
    attributes: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV !== 'development',
    },
  },
  getUserAttributes: (data) => ({
    email: data.email,
    name: data.name,
    role: data.role,
  }),
});
