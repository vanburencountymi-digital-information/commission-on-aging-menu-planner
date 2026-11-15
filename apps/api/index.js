import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import authRouter from './routes/auth.js';
import menusRouter from './routes/menus.js';
import recipesRouter from './routes/recipes.js';
import nutritionRouter from './routes/nutrition.js';
import approvalRouter from './routes/approval.js';
import feedbackRouter from './routes/feedback.js';
import usersRouter from './routes/users.js';
import helpRouter from './routes/help.js';
import frozenStockRouter from './routes/frozenStock.js';
import usdaRouter from './routes/usda.js';
import { globalLimiter } from './middleware/rateLimits.js';
import { passwordGate } from './middleware/gate.js';

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Cloud Run puts exactly one proxy (the Google front end) in front of us, so
// req.ip must come from the last X-Forwarded-For entry it appended. Trusting
// more hops would let clients spoof their IP and dodge the rate limits.
app.set('trust proxy', 1);

app.use(helmet());
app.use(globalLimiter);

// Demo password gate (HTTP Basic Auth) in front of the SPA and the API. Fails
// closed: a production boot without GATE_PASSWORD refuses to start unless the
// gate is explicitly switched off with GATE_DISABLED=true.
if (process.env.GATE_PASSWORD) {
  app.use(passwordGate(process.env.GATE_PASSWORD));
} else if (IS_PRODUCTION && process.env.GATE_DISABLED !== 'true') {
  console.error('GATE_PASSWORD is not set. Set it, or set GATE_DISABLED=true to run without the demo gate.');
  process.exit(1);
}

// Authenticated API responses must never be cached by shared caches or the browser.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

app.use(express.json({ limit: '100kb' }));

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', project: 'coa-menu-planner', version: '1.1' })
);

app.use('/api/auth', authRouter);
app.use('/api/recipes', recipesRouter);
app.use('/api/menus', menusRouter);
app.use('/api/nutrition', nutritionRouter);
app.use('/api/approval', approvalRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/users', usersRouter);
app.use('/api/help', helpRouter);
app.use('/api/frozen-stock', frozenStockRouter);
app.use('/api/usda', usdaRouter);

// Unknown /api paths get a JSON 404 rather than falling through to the SPA.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built SPA from the same origin. In local dev the Vite server handles
// the frontend, so this only activates when apps/web/dist exists.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist, {
    index: false,
    setHeaders: (res, filePath) => {
      // Vite fingerprints everything under /assets, so it can be cached forever.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  // Client-side routes (react-router) all resolve to index.html.
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => console.log(`COA Menu Planner API listening on :${PORT}`));
