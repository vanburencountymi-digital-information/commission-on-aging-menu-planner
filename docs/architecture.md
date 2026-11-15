# DICELabs Architecture Decisions

This document captures the stack choices and rationale for DICELabs / Van Buren County projects.
It exists so future sessions don't re-litigate decisions that were already made the hard way.

---

## Stack at a glance

| Concern           | Choice                          | Notes                                      |
|-------------------|---------------------------------|--------------------------------------------|
| Static hosting    | Firebase Hosting                | CDN, custom domain, free tier              |
| API               | Cloud Run (Node/Express)        | Containerized, auto-scales to zero         |
| Auth              | Firebase Auth                   | See ADR-001 — do not use custom sessions   |
| Database          | Cloud SQL (PostgreSQL)          | Managed Postgres, same GCP project         |
| Secrets           | GCP Secret Manager              | See ADR-003 — nothing in git               |
| CI/CD             | Cloud Build                     | Trigger on push to `main` under `apps/api/`|
| Frontend build    | Vite + React                    | Output to `apps/web/dist/`                 |
| Local DB access   | Cloud SQL Auth Proxy on :5433   | See ADR-004 — IAM auth, no IP allowlist    |

---

## ADR-001 — Use Firebase Auth for all projects requiring user login

> **Not followed by COA Menu Planner** — it uses Lucia sessions; see ADR-006.

**Decision:** Use Firebase Authentication (client SDK + Admin SDK) for session management.
Do not use custom session libraries (Lucia, Passport local strategy, hand-rolled JWTs, etc.).

**Context:**
Firebase Hosting proxies `/api/**` to Cloud Run via a hosting rewrite. This proxy silently
strips all cookies from forwarded requests **except** the one specifically named `__session`.
It also strips `Set-Cookie` response headers unless `Cache-Control: private` is set on every
response. These behaviors are not clearly documented and took significant debugging time to
discover on the COA Menu Planner project.

Custom session libraries (e.g. Lucia v3) default to a cookie named `auth_session`, which is
always stripped. Renaming to `__session` and adding `Cache-Control: private` middleware works,
but it's fragile — any future Firebase Hosting behavior change can silently break auth.

**Firebase Auth avoids this entirely** because it uses Authorization headers (Bearer tokens),
not cookies. The Firebase client SDK handles token refresh automatically. Cloud Run verifies
tokens with the Admin SDK using a single middleware function. No cookies, no stripping, no
`Cache-Control` workaround needed.

**How it works:**

```
Browser                  Firebase Hosting          Cloud Run
  │                           │                        │
  ├─ signInWithEmailAndPassword()                       │
  │   (Firebase Auth SDK)     │                        │
  │                           │                        │
  ├─ GET /api/menus ──────────►                        │
  │  Authorization: Bearer <idToken>                   │
  │                           ├─ forward to Cloud Run ─►
  │                           │   (header preserved)   │
  │                           │                    verifyIdToken()
  │                           │                    (Admin SDK)
  │                           │                        │
  │◄──────────────────────────◄────────────── 200 JSON │
```

**Role-based access:**
Roles are stored as Firebase custom claims (`admin.auth().setCustomUserClaims(uid, { role: 'ADMIN' })`).
`verifyIdToken()` returns the decoded token including custom claims — no extra DB lookup needed
for role checking.

**Consequences:**
- One less session table in the DB
- Token refresh is handled by the client SDK automatically
- Works identically in local dev and production (no `__session` workaround needed locally)
- Firebase Auth supports email/password, Google, and other providers without additional code

---

## ADR-002 — Route all API calls through Firebase Hosting rewrites

> **Superseded for COA Menu Planner by ADR-006** (single Cloud Run service, no Firebase Hosting).

**Decision:** All API requests from the frontend go to `/api/**` as a relative path.
Firebase Hosting rewrites `/api/**` to the Cloud Run service. The frontend never
calls the Cloud Run URL directly.

**Why:**
Direct calls from the browser to a `*.run.app` URL are cross-origin. Browsers increasingly
restrict cross-site cookies, and even with CORS headers, browser behavior varies. Routing
everything through Firebase Hosting makes the frontend and API same-origin, which eliminates
the entire class of cross-origin auth problems.

**`firebase.json` pattern:**
```json
{
  "hosting": {
    "public": "apps/web/dist",
    "rewrites": [
      { "source": "/api/**", "run": { "serviceId": "YOUR_SERVICE_ID", "region": "us-central1" } },
      { "source": "**", "destination": "/index.html" }
    ]
  }
}
```

**Frontend API client:**
```js
// baseURL is '' — all calls are relative, e.g. /api/menus
const http = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' });
```

Do not set `VITE_API_URL` in CI/CD build steps. Leave it unset so production builds use `''`.

---

## ADR-003 — All secrets in GCP Secret Manager; nothing in git

**Decision:** Every secret (DB password, API keys, signing secrets) lives in Secret Manager.
`.env` files are gitignored. `.env.example` files are committed with instructions, not values.

**GCP Secret Manager wiring to Cloud Run:**
```bash
gcloud run services update SERVICE_NAME \
  --set-secrets="DATABASE_URL=SECRET_NAME:latest,ANOTHER_KEY=ANOTHER_SECRET:latest" \
  --region=us-central1
```

**Important:** `--set-secrets` replaces all existing secrets. Always include every secret
in one command, not incremental updates.

**Service account needs `secretmanager.secretAccessor` on each secret:**
```bash
gcloud secrets add-iam-policy-binding SECRET_NAME \
  --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
```

---

## ADR-004 — Cloud SQL Auth Proxy for local dev; IAM auth only

**Decision:** Local development connects to Cloud SQL via the Auth Proxy, not via direct
IP connection or hardcoded credentials.

**Why:**
Cloud SQL can be configured to allow only IAM-authenticated connections via the proxy. This
means no IP allowlisting is needed — any developer with the right IAM role and `gcloud auth
application-default login` can connect from any network. This is the correct fix for
developers on home networks or VPNs who cannot reach a whitelist-controlled IP.

**Setup (one-time per developer machine):**
```bash
gcloud auth login
gcloud auth application-default login   # ← this is what the proxy uses; do not skip
gcloud config set project YOUR_GCP_PROJECT

# Start proxy (leave running while developing)
cloud-sql-proxy PROJECT:REGION:INSTANCE --port=5433
```

Port 5433 is used because 5432 is typically occupied by a local Postgres installation.

**Local DATABASE_URL format:**
```
postgresql://DB_USER:PASSWORD@localhost:5433/DB_NAME
```

The production Secret Manager value uses `?host=/cloudsql/PROJECT:REGION:INSTANCE` (Unix
socket for Cloud Run). The local version replaces this with `@localhost:5433`. They share
the same user/password.

---

## ADR-005 — Express middleware order matters; named routes before wildcard routes

**Decision:** In Express, register all named sub-routes before `/:id` wildcard routes.

Express matches routes in registration order. A `GET /recipes/pending-review` registered
after `GET /:id` will never be reached — Express will match `:id = 'pending-review'` first,
typically causing a DB UUID validation error (500).

**Always:**
```js
router.get('/pending-review', ...)  // ← before /:id
router.get('/:id', ...)
```

---

## ADR-006 — COA Menu Planner demo: single Cloud Run service, app-level password gate

**Decision:** The demo deploys as one Cloud Run service that serves both the API and the
built React SPA from the same origin, in its own GCP project. Firebase Hosting is not used.
A shared password (HTTP Basic Auth middleware, `GATE_PASSWORD`) sits in front of everything;
the app's own Lucia login sits behind it.

**Why:**
- ADR-001/002 existed to work around Firebase Hosting's cookie stripping and its 60 s rewrite
  timeout. Menu generation takes 90-120 s, so the workaround was calling Cloud Run cross-origin,
  which required `SameSite=None` cookies, a CORS allowlist, and a second CI pipeline.
  Serving the SPA from Express removes the whole class of problem: relative `/api` calls,
  `SameSite=Lax` cookies, no CORS, one deploy.
- The gate is middleware rather than nginx or IAP to keep one container and no extra moving
  parts. Any username is accepted; the password is compared in constant time, failures are
  locked out per IP, and the server refuses to start in production without it (override only
  with `GATE_DISABLED=true`).

**Consequences:**
- Rate limits are in memory per instance, so keep `--max-instances` low (2-3) on the demo.
- `trust proxy` is set to 1 (the single Google front end in front of Cloud Run); do not raise it.
- For a real production launch, replace the shared gate with per-user SSO/IAP and require
  auth on the read-only recipe/menu/nutrition GET routes that are currently public.

---

## Local dev checklist for new projects

Before writing any code on a new dev machine:

- [ ] `gcloud auth login`
- [ ] `gcloud auth application-default login`
- [ ] `gcloud config set project YOUR_GCP_PROJECT`
- [ ] Cloud SQL Auth Proxy running on port 5433
- [ ] `apps/api/.env` created from `.env.example` (password from Secret Manager)
- [ ] `npm install` in project root (workspaces)
- [ ] API server running (`npm run dev` in `apps/api/`)
- [ ] Confirm `/health` returns 200 before running tests
