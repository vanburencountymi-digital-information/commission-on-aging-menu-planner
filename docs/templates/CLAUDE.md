# CLAUDE.md — {{PROJECT_NAME}} (DICELabs)

This file is read automatically by Claude Code at the start of every session.
Follow these conventions precisely.

---

## Project overview

**{{PROJECT_NAME}}** — {{ONE_LINE_DESCRIPTION}}

**Stack:**
- Backend: Node.js / Express (`apps/api/`) — PostgreSQL via Cloud SQL (GCP)
- Frontend: React + Vite (`apps/web/`)
- Auth: Firebase Authentication (client SDK + Admin SDK) — see `apps/api/middleware/requireAuth.js`
- Database migrations: `apps/api/db/migrations/` — numbered SQL files, run via `migrateN.js`
- AI integrations: Anthropic Claude (Haiku for classification, Sonnet for generation)
- Infrastructure: Docker-based, Cloud SQL Auth Proxy on port 5433

**Team:**
- GIS / DICE: issue creation, session direction, final review
- Drake: infrastructure, DB, deployment, GitHub repo owner (`vanburencountymi-digital-information`)

---

## Linear workflow

Every Claude Code session maps to a Linear issue in the **DICELabs** workspace.

### Starting a session
Always begin by stating the issue ID:
> "Working on DIC-XXX"

Claude Code should:
1. Read this file
2. Look up the Linear issue for full context, acceptance criteria, and file references
3. Check git status and current branch before touching anything
4. Confirm the plan before writing code

### Branch naming
Branches are pre-named in Linear. Use the `gitBranchName` field exactly:

```
gis/dic-XXX-short-description
```

Create the branch if it doesn't exist: `git checkout -b gis/dic-XXX-...`

### During a session
- Work in small, verifiable increments
- After each meaningful change: state what was done and what's next
- If blocked (missing env var, proxy not running, unclear spec): **stop and say so** — don't guess

### Completing a session
When work is done:
1. Summarize what was built (files created/modified, routes added, migrations run)
2. State what the next session should pick up (if anything remains)
3. Do NOT mark the Linear issue as Done — that's a human step after review

---

## Environment notes

| Thing | Detail |
|---|---|
| Python | `py -3` (not `python` or `python3`) |
| UTF-8 flag | Always use `py -3 -X utf8` for test scripts |
| Local Postgres | Port 5432 |
| Cloud SQL Proxy | Port 5433 — must be running for API and tests |
| API server | Runs at `localhost:3001` |

---

## GCP reference

| Resource | Value |
|---|---|
| Project | `{{GCP_PROJECT_ID}}` |
| Cloud SQL instance | `{{GCP_PROJECT_ID}}:us-central1:{{CLOUD_SQL_INSTANCE}}` |
| Database | `{{DB_NAME}}` |
| DB user | `{{DB_USER}}` |
| Cloud Run service | `{{SERVICE_NAME}}` |
| Firebase project | `{{FIREBASE_PROJECT_ID}}` |
| Production URL | `https://{{FIREBASE_PROJECT_ID}}.web.app` |
| Auto-deploy | Push to `main` under `apps/api/` triggers Cloud Build automatically |

---

## Auth pattern

This project uses **Firebase Authentication** with Bearer tokens — not cookies.

**How it works:**
1. Frontend calls `signInWithEmailAndPassword(auth, email, password)` (Firebase client SDK)
2. On each API request, frontend gets a fresh ID token: `await getAuth().currentUser.getIdToken()`
3. Token is sent as `Authorization: Bearer <token>`
4. Cloud Run middleware verifies it with `getAuth().verifyIdToken(token)` (Firebase Admin SDK)
5. User role is read from custom claims: `decoded.role`

**Setting roles** (run once per user via admin script or POST /api/users):
```js
import { getAuth } from 'firebase-admin/auth';
await getAuth().setCustomUserClaims(uid, { role: 'ADMIN' });
```

**`requireAuth` middleware** (`apps/api/middleware/requireAuth.js`):
```js
requireAuth()                          // any authenticated user
requireAuth('ADMIN')                   // ADMIN only
requireAuth('NUTRITION_MANAGER', 'ADMIN')  // either role
```

---

## Database conventions

- Migrations are numbered SQL files: `apps/api/db/migrations/NNN_description.sql`
- Each migration has a paired runner: `apps/api/db/migrateN.js`
- Never modify existing migrations — always create a new numbered one
- Run migrations manually: `DATABASE_URL="postgresql://..." node apps/api/db/migrateN.js`

---

## AI integration conventions

| Use case | Model |
|---|---|
| Classification, matching, short structured output | `claude-haiku-4-5` |
| Generation, narrative text, complex reasoning | `claude-sonnet-4-20250514` |

- All Claude calls go through `apps/api/services/ai.js`
- Use tool-based (structured) calls whenever the output maps to a DB schema
- Validate all returned IDs against the DB before using them (hallucination guard)
- New AI functions: add to `ai.js`, wire route in relevant `routes/*.js`, add frontend call to `apps/web/src/lib/api.js`

---

## Testing

```bash
# One-time setup
cd coa-tests/
cp .env.example .env
py -3 -X utf8 setup.py

# Full suite
py -3 -X utf8 run_all.py
# Results → coa-tests/test_results.json
```

Cloud SQL Auth Proxy must be running and API server must be up before tests.

---

## Git rules

- Always work on the issue branch — never commit directly to `main`
- Commit after every completed feature or fix; never leave the repo in a broken state
- Commit messages reference the Linear issue: `feat: add X [DIC-42]`
- Never commit `.env` files — secrets stay out of git
- Never commit a hardcoded staging/production URL in `vite.config.js` proxy target

---

## What NOT to do

- Do not run `python` or `python3` — always `py -3`
- Do not modify existing migration files
- Do not mark Linear issues Done — leave that for human review
- Do not commit directly to `main`
- Do not expose secrets or API keys in code or comments
- Do not skip the plan confirmation step before writing code
- Do not use custom session libraries (Lucia, Passport, etc.) — Firebase Auth only
- Do not call the Cloud Run URL directly from the frontend — always use relative `/api/*` paths
