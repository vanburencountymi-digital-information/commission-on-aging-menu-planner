# CLAUDE.md — COA Menu Planner (DICELabs)

This file is read automatically by Claude Code at the start of every session.
Follow these conventions precisely.

---

## Project overview

**COA Menu Planner** is a web app for Van Buren County's Council on Aging to manage
OAA-compliant meal menus, recipes, nutrition tracking, client feedback, and vendor ordering.

**Stack:**
- Backend: Node.js / Express (`apps/api/`) — PostgreSQL via Cloud SQL (GCP)
- Frontend: React + Vite (`apps/web/`)
- Database migrations: `apps/api/db/migrations/` — numbered SQL files, run via `migrateN.js`
- AI integrations: Anthropic Claude (Haiku for classification/matching, Sonnet for generation)
- Infrastructure: Docker-based, Drake's stack — PostgreSQL local on port 5432, Cloud SQL Auth Proxy on port 5433
- Test suite: `coa-tests/` — Python, invoked as `py -3 -X utf8`

**Team:**
- GIS / DICE (you): issue creation, session direction, final review
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

**A task is "complete" only when its commit is on `origin/main`.** Until then, treat it as in-progress regardless of how finished the local diff looks. Issues closed with detailed "what was built" notes that never actually landed have cost full audit sessions to recover (see DIC-100, DIC-110).

When work is done:
1. **Verify the change is real**, in this order:
   - `git status` — clean working tree, no stragglers
   - `git log --branches --not --remotes --oneline` — empty (every local commit is pushed)
   - `git log origin/main -1 --oneline` — your most recent commit appears at the tip
   - For frontend work: `npm run build --workspace=apps/web` passes
   - For backend work: `node --check` on changed files passes
2. **Summarize what was built from the actual diff**, not from what you intended — list real files, real routes, real migrations. If you can't point at a commit hash, the work isn't done.
3. **Post a comment on the Linear issue with the commit hash(es)** — this is the correct "ready for review" signal.
4. **Do NOT mark the Linear issue as Done** — that's a human step after review.
5. **Never write a completion summary into the Linear issue *description*** — descriptions are for the spec, comments are for status. Completion claims belong in commit messages and comments, both of which are tied to a hash.

If a session ends with uncommitted or unpushed changes, say so explicitly in the final summary — "this work is local-only on `<branch>`" — so the next session knows to recover it.

---

## Environment notes

| Thing | Detail |
|---|---|
| Python | `py -3` (not `python` or `python3` — avoids PATH conflict with Inkscape's Python 3.8) |
| UTF-8 flag | Always use `py -3 -X utf8` for test scripts |
| Local Postgres | Port 5432 |
| Cloud SQL Proxy | Port 5433 — must be running for tests and API DB calls |
| API server | Runs at `localhost:3001` |
| Tesseract | `C:\Program Files\Tesseract-OCR\tesseract.exe` |
| Poppler | `C:\poppler\Library\bin` |
| Git Bash | `C:\Program Files\Git\bin\bash.exe` |

---

## GCP reference

| Resource | Value |
|---|---|
| Project | `coa-menu-demo` (moved from `core-db-475718` under DIC-2239) |
| Cloud SQL instance | `coa-menu-demo:us-central1:coa-menu-planner` (TLS required, no authorized networks) |
| Database | `coa_menu_planner` |
| DB user | `coa-menu-planner-app` |
| Demo URL | `https://coa-menu-planner-612501733590.us-central1.run.app` (behind a Basic-auth password gate; see `GATE_PASSWORD` in Secret Manager) |
| Deploy | Manual: `gcloud builds submit --config cloudbuild.yaml --project coa-menu-demo .` — one Cloud Run service serves API + SPA (ADR-006). No auto-deploy trigger and no Firebase Hosting. |
| Secrets | Secret Manager in `coa-menu-demo`: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `USDA_API_KEY`, `GATE_PASSWORD`, `SQL_ROOT_PASSWORD` |

---

## Database conventions

- Migrations are numbered SQL files: `apps/api/db/migrations/NNN_description.sql`
- Each migration has a paired runner: `apps/api/db/migrateN.js`
- Never modify existing migrations — always create a new numbered one
- Run migrations manually via: `node apps/api/db/migrateN.js`

---

## AI integration conventions

| Use case | Model |
|---|---|
| Classification, matching, short structured output | `claude-haiku-4-5` |
| Recipe generation, menu proposals, narrative text | `claude-sonnet-4-5` |

- All Claude calls go through `apps/api/services/ai.js`
- Use tool-based (structured) calls whenever the output maps to a DB schema
- Validate all returned IDs against the DB before using them (hallucination guard)
- New AI functions: add to `ai.js`, wire route in relevant `routes/*.js`, add frontend API call to `apps/web/src/lib/api.js`

---

## Testing

```bash
# One-time setup (creates test accounts + seeds recipes)
cd coa-tests/
py -3 -X utf8 setup.py

# Full test suite
py -3 -X utf8 run_all.py
# Results → coa-tests/test_results.json
```

**Cloud SQL Auth Proxy must be running** before tests:

```bash
cloud-sql-proxy coa-menu-demo:us-central1:coa-menu-planner --port=5433
```

Some pre-wired FAILs are expected (missing USDA route, submit validation gap, endpoint name
mismatches vs guide spec) — these are known bugs to fix, not setup problems.

---

## Git rules

- Always work on the issue branch — never commit directly to `main`
- Commit after every completed feature or fix; never leave the repo in a broken state
- Commit messages must reference the Linear issue ID: `feat: add X [DIC-42]`
- Never commit `.env` files — secrets stay out of git
- Never commit `apps/web/vite.config.js` with a staging/production URL hardcoded in the proxy target — keep it pointing to `http://localhost:3001` in git

---

## What NOT to do

- Do not run `python` or `python3` directly — always `py -3`
- Do not modify existing migration files
- Do not mark Linear issues Done — leave that for human review
- Do not write completion notes on a Linear issue before the corresponding commit is verified on `origin/main` — descriptions are for specs, comments are for status, completion claims belong with a hash
- Do not commit directly to `main` — always work on the issue branch
- Do not expose secrets or API keys in code or comments
- Do not skip the plan confirmation step before writing code
- Do not commit `vite.config.js` with a staging URL in the proxy target
