import { createHash, timingSafeEqual } from 'node:crypto';

// Demo password gate: HTTP Basic Auth in front of the whole app (SPA and API).
// Any username is accepted; only the password is checked. Browsers cache the
// credentials for the origin, so XHR/fetch calls from the SPA are covered too.

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

const digest = (value) => createHash('sha256').update(value).digest();

// Failed-attempt counters per client IP, in memory (per Cloud Run instance).
// Only requests that actually present wrong credentials count; the initial
// credential-less request a browser makes before showing its prompt does not.
const failures = new Map();

function recordFailure(ip) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) {
    failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function isLockedOut(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failures) if (entry.resetAt <= now) failures.delete(ip);
}, WINDOW_MS).unref();

function readPassword(header) {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  return sep === -1 ? null : decoded.slice(sep + 1);
}

export function passwordGate(password) {
  const expected = digest(password);

  return (req, res, next) => {
    if (req.path === '/health') return next();

    if (isLockedOut(req.ip)) {
      res.setHeader('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
      return res.status(429).send('Too many failed attempts. Try again later.');
    }

    const supplied = readPassword(req.headers.authorization);
    if (supplied !== null && timingSafeEqual(digest(supplied), expected)) {
      return next();
    }

    if (supplied !== null) recordFailure(req.ip);
    res.setHeader('WWW-Authenticate', 'Basic realm="COA Menu Planner demo", charset="UTF-8"');
    res.status(401).send('Authentication required.');
  };
}
