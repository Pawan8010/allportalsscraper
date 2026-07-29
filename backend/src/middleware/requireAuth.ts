import { NextFunction, Request, Response } from "express";
import { validateSession } from "../services/authService";
import { env } from "../config/env";
import { ApiError } from "./errorHandler";

// Augment Express's Request type with the authenticated user, set by this
// middleware once a valid session cookie is found. Declared here (the one
// place req.user is ever assigned) rather than a separate .d.ts file.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: string };
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const rawToken = req.cookies?.[env.sessionCookieName];
  if (!rawToken) return next(new ApiError(401, "Not logged in."));

  const session = await validateSession(rawToken);
  if (!session) return next(new ApiError(401, "Session expired or invalid, please log in again."));

  req.user = { id: session.user.id, email: session.user.email, role: session.user.role };
  next();
}
