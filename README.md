# COA Menu Planner

Menu planning application for St. Joseph County Commission on Aging.

## Structure

```
apps/api/   — Node.js + Express backend (deploys to Cloud Run)
apps/web/   — React + Vite frontend
```

## Local Development

No Docker required. Run the API and frontend directly:

```bash
npm install

# Terminal 1 — API (port 3001)
npm run dev:api

# Terminal 2 — Frontend (port 3000, proxies /api to :3001)
npm run dev:web
```

### Database (Cloud SQL)

The database lives on Cloud SQL. For local dev, use the Cloud SQL Auth Proxy.

**Important:** local Postgres runs on 5432, so run the proxy on **5433** to avoid conflict:

```bash
cloud-sql-proxy coa-menu-demo:us-central1:coa-menu-planner --port=5433
```

`apps/api/.env` `DATABASE_URL` must point to `localhost:5433`.

#### Getting the proxy running (SSL note)

The proxy is a Go binary that verifies Google's TLS certs. On machines with corporate
SSL inspection this fails. Two options:

1. **Ask IT** to add a bypass rule for `sqladmin.googleapis.com` and
   `oauth2.googleapis.com` — SSL inspection on GCP API traffic is unusual and a bypass
   is the clean fix.
2. **Try `gcloud sql connect`** — goes through the gcloud Python SDK which handles TLS
   differently and often works where the standalone proxy binary doesn't:
   ```bash
   gcloud sql connect coa-menu-planner --user=coa-menu-planner-app --database=coa_menu_planner
   ```
3. **Have Drake run it** — Drake can run migrations and seeds directly against Cloud SQL
   from a machine without SSL inspection. This is the current fallback.

#### Fetch secrets from GCP Secret Manager

```bash
gcloud secrets versions access latest --secret=DATABASE_URL --project=coa-menu-demo
gcloud secrets versions access latest --secret=USDA_API_KEY --project=coa-menu-demo
```

(If `gcloud` SSL fails, use curl + `gcloud auth print-access-token` — see CLAUDE.md.)

### Running migrations and seeds

Drake runs these against Cloud SQL directly:

```bash
psql $DATABASE_URL < apps/api/db/migrations/001_initial_schema.sql
psql $DATABASE_URL < apps/api/db/seeds/001_recipes.sql
```

Local alternative (no psql required):
```bash
cd apps/api && node db/migrate.js
```

## Deployment

One Cloud Run service serves both the API and the built SPA from the same origin
(see ADR-006 in `docs/architecture.md`). There is no Firebase Hosting.

The root `Dockerfile` builds the web app and the API into one image. Roll out a new
revision of an existing service with:

```bash
gcloud builds submit --config cloudbuild.yaml --project <project> .
```

Runtime configuration (all from Secret Manager except where noted):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (`?host=/cloudsql/...` socket form on Cloud Run) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `USDA_API_KEY` | USDA FoodData Central key |
| `GATE_PASSWORD` | Demo gate password (HTTP Basic Auth). Production refuses to boot without it unless `GATE_DISABLED=true` |
| `NODE_ENV` | `production` (set by the Dockerfile) |

Rate limits are in memory per instance, so keep `--max-instances` low on the demo.

### Seeding users

```bash
# Random per-account passwords, written to a file (never to git):
SEED_CREDENTIALS_FILE=./credentials.txt node apps/api/db/seeds/002_users.js

# Local dev only: one shared password
SEED_PASSWORD=changeme123 node apps/api/db/seeds/002_users.js
```
