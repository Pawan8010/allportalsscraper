import { NextFunction, Request, Response } from "express";
import { ApiError } from "./errorHandler";

// Must run after requireAuth -- relies on req.user already being set.
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return next(new ApiError(403, "Admin access required."));
  next();
}
