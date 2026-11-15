# Single image serving the API and the built SPA from the same origin.
# Build context is the repo root:  docker build -t coa-menu-planner .

# ---- Stage 1: build the React SPA ------------------------------------------
FROM node:24-alpine AS web-build
WORKDIR /build

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace=apps/web

COPY apps/web apps/web
# VITE_API_URL is intentionally unset: the SPA calls /api on its own origin.
RUN npm run build --workspace=apps/web

# ---- Stage 2: runtime ------------------------------------------------------
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace=apps/api

COPY apps/api apps/api
COPY --from=web-build /build/apps/web/dist apps/web/dist

USER node
EXPOSE 8080
CMD ["node", "apps/api/index.js"]
