/**
 * Frontend Axios client — Firebase Auth + Firebase Hosting rewrite pattern
 *
 * Drop this in apps/web/src/lib/api.js
 *
 * Key points:
 *   - baseURL is '' so all calls are relative (/api/...) and go through Firebase Hosting
 *   - Authorization header is set automatically from Firebase ID token on every request
 *   - Token is refreshed automatically by the Firebase SDK (valid for 1 hour, auto-renewed)
 *   - 401 redirects to /login (except on the /auth/me check itself)
 *
 * Dependencies:
 *   npm install axios firebase
 */

import axios from 'axios';
import { getAuth } from 'firebase/auth';

const http = axios.create({
  // Empty baseURL = all requests are relative to the current origin.
  // Firebase Hosting rewrites /api/** to Cloud Run.
  // Do NOT set this to the Cloud Run URL directly — that causes cross-origin issues.
  baseURL: import.meta.env.VITE_API_URL ?? '',
});

// Attach Firebase ID token to every outbound request
http.interceptors.request.use(async (config) => {
  const user = getAuth().currentUser;
  if (user) {
    // getIdToken(false) returns cached token; refreshes automatically when expired
    const token = await user.getIdToken();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login on 401
http.interceptors.response.use(
  (response) => response,
  (err) => {
    if (
      err.response?.status === 401 &&
      !err.config.url?.includes('/auth/me')
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default http;
