import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Counters live in memory, so each Cloud Run instance enforces its own limits.
// Keep max-instances low (2-3) on the demo so the effective ceiling stays close
// to the numbers below.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function limiter({ windowMs, limit, message, ...rest }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
    ...rest,
  });
}

// Per-IP ceiling for every request. /health is exempt so probes never get throttled.
export const globalLimiter = limiter({
  windowMs: MINUTE,
  limit: 300,
  message: 'Too many requests. Please slow down and try again shortly.',
  skip: (req) => req.path === '/health',
});

// Login: only failed attempts count (successful logins are skipped), tracked
// both per IP and per target account so one IP can't spray many accounts and
// many IPs can't hammer one account.
export const loginIpLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  message: 'Too many failed login attempts. Try again in 15 minutes.',
});

export const loginEmailLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 5,
  skipSuccessfulRequests: true,
  message: 'Too many failed login attempts for this account. Try again in 15 minutes.',
  keyGenerator: (req) => {
    const email = req.body?.email;
    return typeof email === 'string' && email.trim()
      ? `email:${email.toLowerCase().trim()}`
      : ipKeyGenerator(req.ip);
  },
});

// Anonymous feedback submissions (the one intentionally public write).
export const feedbackLimiter = limiter({
  windowMs: HOUR,
  limit: 20,
  message: 'Too many feedback submissions. Please try again later.',
});

// AI endpoints. These run after requireAuth, so they are keyed per user.
// Light: short Haiku-style calls (help chat, USDA matching, suggestions, explain).
// Heavy: long Sonnet generations (menu proposals, recipe generation/import, narratives, edits).
const perUser = (req) => `user:${req.user.id}`;

export const aiLightLimiter = limiter({
  windowMs: 10 * MINUTE,
  limit: 60,
  message: 'AI request limit reached. Please wait a few minutes and try again.',
  keyGenerator: perUser,
});

export const aiHeavyLimiter = limiter({
  windowMs: HOUR,
  limit: 15,
  message: 'AI generation limit reached for this hour. Please try again later.',
  keyGenerator: perUser,
});
