import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
/** True for any error carrying its own numeric HTTP status (ApiError, CorsError). */
function statusFrom(err: unknown): number | null {
  if (err instanceof ApiError) return err.status;
  const candidate = (err as { status?: unknown })?.status;
  return typeof candidate === "number" && candidate >= 400 && candidate <= 599 ? candidate : null;
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  const status = statusFrom(err) ?? 500;
  const message = err instanceof Error ? err.message : "Internal server error";

  if (status >= 500) {
    logger.error({ err }, `Unhandled error on ${req.method} ${req.originalUrl}`);
  } else {
    logger.warn(`Request error on ${req.method} ${req.originalUrl}: ${message}`);
  }

  res.status(status).json({ error: message });
}
