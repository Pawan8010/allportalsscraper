import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";

import { config } from "./config/env";
import { logger } from "./utils/logger";
import tenderRoutes from "./routes/tenders";
import scrapeRoutes from "./routes/scrape";
import portalRoutes from "./routes/portals";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

/**
 * `localhost` and `127.0.0.1` are different origins to a browser but the same
 * dev server to a developer, so an entry for either in CORS_ORIGIN authorises
 * both. Anything not listed is still rejected.
 */
function expandLocalhostOrigins(origins: string[]): Set<string> {
  const expanded = new Set<string>();
  for (const origin of origins) {
    expanded.add(origin);
    if (origin.includes("//localhost")) expanded.add(origin.replace("//localhost", "//127.0.0.1"));
    if (origin.includes("//127.0.0.1")) expanded.add(origin.replace("//127.0.0.1", "//localhost"));
  }
  return expanded;
}

const allowedOrigins = expandLocalhostOrigins(config.corsOrigin);

/** Raised for a disallowed Origin so the error handler can answer 403, not 500. */
class CorsError extends Error {
  readonly status = 403;
  constructor(origin: string) {
    super(
      `Origin ${origin} is not allowed. Add it to CORS_ORIGIN (currently: ${config.corsOrigin.join(", ")}) and restart the API.`
    );
  }
}

/**
 * Fails a request that has run far past the point where the browser has given
 * up, with a JSON body the UI can show instead of a bare "Failed to fetch".
 */
function requestTimeout(ms: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      logger.warn(`Request timed out after ${ms}ms: ${req.method} ${req.originalUrl}`);
      res.status(503).json({
        error: `Request timed out after ${ms}ms`,
        hint: "The database or the GeM portal took too long to respond. Retry in a moment.",
      });
    }, ms);
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: curl, health checks, same-origin server calls.
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin)) return callback(null, true);
        callback(new CorsError(origin));
      },
      credentials: false,
    })
  );
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));
  app.use(requestTimeout(config.requestTimeoutMs));

  // Generous limit: search is meant to feel instant while typing.
  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      max: config.rateLimitPerMinute,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests - slow down and retry shortly." },
    })
  );

  app.get("/health", (req, res) => res.json({ status: "ok" }));

  // Deeper check for ops: confirms PostgreSQL actually answers.
  app.get("/health/db", async (req, res) => {
    const { prisma } = await import("./config/db");
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "reachable" });
    } catch (error) {
      res.status(503).json({
        status: "error",
        database: "unreachable",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.use("/api/tenders", tenderRoutes);
  app.use("/api/scrape", scrapeRoutes);
  app.use("/api/portals", portalRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
