import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ override: true });

/**
 * Startup validation for every environment variable the service reads.
 * Anything missing or malformed fails fast with an actionable message
 * instead of surfacing later as a confusing runtime error.
 */
const intFromEnv = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? fallback : Number(value)))
    .pipe(
      z
        .number({ invalid_type_error: "must be a number" })
        .int("must be a whole number")
        .min(min, `must be >= ${min}`)
        .max(max, `must be <= ${max}`)
    );

const boolFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? fallback : value.toLowerCase() === "true"));

const envSchema = z.object({
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required (PostgreSQL connection string)" })
    .min(1, "DATABASE_URL must not be empty")
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgresql:// connection string",
    }),
  PORT: intFromEnv(4000, 1, 65535),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  GEM_BASE_URL: z
    .string()
    .default("https://bidplus.gem.gov.in")
    .refine((value) => /^https?:\/\//.test(value), { message: "GEM_BASE_URL must be an http(s) URL" }),
  SCRAPE_CRON: z.string().default("0 */6 * * *"),
  SCRAPER_MAX_PAGES: intFromEnv(0, 0, 1_000_000),
  SCRAPER_REQUEST_DELAY_MS: intFromEnv(150, 0, 60_000),
  SCRAPER_API_CONCURRENCY: intFromEnv(6, 1, 32),
  PORTAL_SCRAPER_CONCURRENCY: intFromEnv(3, 1, 8),
  SCRAPER_MAX_RETRIES: intFromEnv(4, 1, 10),
  SCRAPER_TIMEOUT_MS: intFromEnv(45_000, 1_000, 300_000),
  SCRAPER_START_PAGE: intFromEnv(1, 1, 1_000_000),
  NEW_TENDER_MAX_PAGES: intFromEnv(60, 1, 1_000_000),
  SCRAPER_HEADLESS: boolFromEnv(true),
  SCRAPER_USER_AGENT: z
    .string()
    .default(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
  // Live GeM sync during search. Disabled -> search is served purely from PostgreSQL.
  LIVE_SEARCH_ENABLED: boolFromEnv(true),
  LIVE_SEARCH_MAX_PAGES: intFromEnv(10, 1, 10_000),
  LIVE_SEARCH_TTL_MS: intFromEnv(15 * 60 * 1000, 10_000, 24 * 60 * 60 * 1000),
  // Upper bound on how long a single API request may take before it is failed
  // with a readable JSON error instead of hanging until the browser gives up.
  REQUEST_TIMEOUT_MS: intFromEnv(30_000, 1_000, 300_000),
  RATE_LIMIT_PER_MINUTE: intFromEnv(300, 1, 100_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`).join("\n");
  // Written straight to stderr: the logger itself depends on this config.
  process.stderr.write(`Invalid environment configuration:\n${details}\n\nCopy backend/.env.example to backend/.env and fill in the values.\n`);
  throw new Error("Invalid environment configuration");
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  corsOrigin: env.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  scrapeCron: env.SCRAPE_CRON,
  gemBaseUrl: env.GEM_BASE_URL.replace(/\/+$/, ""),
  scraperHeadless: env.SCRAPER_HEADLESS,
  scraperMaxRetries: env.SCRAPER_MAX_RETRIES,
  scraperTimeoutMs: env.SCRAPER_TIMEOUT_MS,
  scraperMaxPages: env.SCRAPER_MAX_PAGES,
  newTenderMaxPages: env.NEW_TENDER_MAX_PAGES,
  scraperRequestDelayMs: env.SCRAPER_REQUEST_DELAY_MS,
  scraperApiConcurrency: env.SCRAPER_API_CONCURRENCY,
  portalScraperConcurrency: env.PORTAL_SCRAPER_CONCURRENCY,
  scraperStartPage: env.SCRAPER_START_PAGE,
  scraperUserAgent: env.SCRAPER_USER_AGENT,
  liveSearchEnabled: env.LIVE_SEARCH_ENABLED,
  liveSearchMaxPages: env.LIVE_SEARCH_MAX_PAGES,
  liveSearchTtlMs: env.LIVE_SEARCH_TTL_MS,
  requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
  rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
} as const;

export type AppConfig = typeof config;
