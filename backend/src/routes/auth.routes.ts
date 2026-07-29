import { Router } from "express";
import { z } from "zod";
import { registerUser, loginUser, revokeSession, AuthError } from "../services/authService";
import { requireAuth } from "../middleware/requireAuth";
import { authLimiter } from "../middleware/rateLimit";
import { ApiError } from "../middleware/errorHandler";
import { env } from "../config/env";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

function sessionContext(req: import("express").Request) {
  return { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function setSessionCookie(res: import("express").Response, rawToken: string, expiresAt: Date) {
  res.cookie(env.sessionCookieName, rawToken, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    expires: expiresAt,
  });
}

authRouter.post("/auth/register", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body ?? {});
    const { user, rawToken, expiresAt } = await registerUser(email, password, sessionContext(req));
    setSessionCookie(res, rawToken, expiresAt);
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    if (err instanceof AuthError) return next(new ApiError(err.status, err.message));
    next(err);
  }
});

authRouter.post("/auth/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body ?? {});
    const { user, rawToken, expiresAt } = await loginUser(email, password, sessionContext(req));
    setSessionCookie(res, rawToken, expiresAt);
    res.json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    if (err instanceof AuthError) return next(new ApiError(err.status, err.message));
    next(err);
  }
});

authRouter.post("/auth/logout", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.[env.sessionCookieName];
    if (rawToken) await revokeSession(rawToken);
    res.clearCookie(env.sessionCookieName);
    res.json({ loggedOut: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});
