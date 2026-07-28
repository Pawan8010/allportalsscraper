import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { healthRouter } from "./routes/health.routes";
import { portalsRouter } from "./routes/portals.routes";
import { scrapeRouter } from "./routes/scrape.routes";
import { tendersRouter } from "./routes/tenders.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin/non-browser requests (no Origin header) and any
        // explicitly allowlisted origin. Reject everything else instead of
        // reflecting "*", since this API can trigger scrape jobs.
        if (!origin || env.corsAllowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS policy`));
      },
    })
  );

  app.use(healthRouter);
  app.use("/api", portalsRouter);
  // scrapeRouter applies scrapeTriggerLimiter itself, per-route, only on the
  // actual trigger endpoints -- app.use(path, middleware, router) would run
  // that middleware for every request under "/api" regardless of which
  // router ends up handling it, which previously rate-limited search too.
  app.use("/api", scrapeRouter);
  app.use("/api", tendersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
