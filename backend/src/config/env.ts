import dotenv from "dotenv";
dotenv.config();

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v.toLowerCase() === "true";
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  port: num("PORT", 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "",
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  portalScrapeEnabled: bool("PORTAL_SCRAPE_ENABLED", true),
  portalConcurrency: num("PORTAL_CONCURRENCY", 3),
  portalRequestDelayMs: num("PORTAL_REQUEST_DELAY_MS", 500),
  portalMaxRetries: num("PORTAL_MAX_RETRIES", 3),
  portalTimeoutMs: num("PORTAL_TIMEOUT_MS", 45000),
  // Concurrent organisation-page fetches within a single GePNIC portal's
  // by-organisation crawl (separate dial from portalConcurrency, which is
  // how many *portals* run at once).
  gepnicOrgConcurrency: num("GEPNIC_ORG_CONCURRENCY", 6),
  // Incremental (latest-page-only) check: cheap per portal, so hourly is
  // fine. Full sweep: re-walks every page, so kept to once a day.
  scrapeCron: process.env.SCRAPE_CRON ?? "0 * * * *",
  fullScrapeCron: process.env.FULL_SCRAPE_CRON ?? "0 3 * * *",
  // Kick off an incremental scrape immediately on startup rather than
  // waiting for the first cron mark, so a freshly started backend doesn't
  // sit with stale data for up to an hour before anything happens.
  scrapeOnStartup: bool("SCRAPE_ON_STARTUP", true),

  // GeM's public JSON API can be walked with real concurrency (unlike the
  // GePNIC portals, which are plain HTML pages on much smaller government
  // servers) -- kept separate from the shared portalConcurrency/
  // portalRequestDelayMs so cranking this up for a full 48k-bid sweep never
  // also speeds up (and stresses) every other portal's scraper.
  gemApiConcurrency: num("GEM_API_CONCURRENCY", 5),
  gemApiRequestDelayMs: num("GEM_API_REQUEST_DELAY_MS", 300),

  logLevel: process.env.LOG_LEVEL ?? "info",

  // Per-portal enable flags, read lazily by the registry so a portal can be
  // disabled purely through .env without touching code.
  portalEnabled(key: string, fallback = true): boolean {
    const envKey = `PORTAL_${key.toUpperCase()}_ENABLED`;
    return bool(envKey, fallback);
  },
};
