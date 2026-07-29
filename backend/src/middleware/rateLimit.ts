import rateLimit from "express-rate-limit";

// Guards the scrape-trigger endpoints against accidental double-clicks from
// the UI kicking off duplicate jobs (the orchestrator's per-portal lock
// already prevents overlapping scrapes; this just stops request floods).
export const scrapeTriggerLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many scrape requests, slow down." },
});

// Sign-up is public and login is a natural credential-stuffing target --
// both need a tighter cap than the scrape-trigger routes.
export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many attempts, slow down." },
});
