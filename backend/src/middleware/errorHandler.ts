import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // A failed req.body validation is a client mistake (bad input), not a
  // server fault -- surface the first validation message and a 400 instead
  // of the generic 500 this would otherwise fall through to.
  if (err instanceof ZodError) {
    const message = err.errors[0]?.message ?? "Invalid request.";
    res.status(400).json({ error: "validation_error", message });
    return;
  }
  const status = err instanceof ApiError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Unexpected error";
  logger.error({ err: message, path: req.path }, "request failed");
  res.status(status).json({ error: status === 500 ? "internal_error" : "request_error", message });
}
