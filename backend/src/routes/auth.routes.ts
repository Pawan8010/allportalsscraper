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
    // Without an explicit path, a cookie set from a POST to /api/auth/login
    // defaults (per RFC 6265) to the *directory* of the request that set it
    // -- "/api/auth" -- so the browser only ever sends it back on other
    // /api/auth/* requests. Every other route (/api/tenders/search,
    // /api/portals, /api/alerts/*, ...) would silently never receive it,
    // failing requireAuth with "Not logged in." even though the session is
    // genuinely valid (confirmed live, 30 Jul 2026: /api/auth/me succeeded
    // while every other endpoint 401'd for the same real, active session).
    // curl's cookie jar doesn't enforce this the same way a real browser
    // does, which is why extensive curl-based testing never caught it.
    path: "/",
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
    // Must match the Path the cookie was actually set with (now "/",
    // see setSessionCookie above) or the browser won't recognise this as
    // clearing the same cookie and it would linger.
    res.clearCookie(env.sessionCookieName, { path: "/" });
    res.json({ loggedOut: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});
