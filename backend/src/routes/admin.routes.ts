import { Router } from "express";
import { z } from "zod";
import { createUserByAdmin, listSessions, listUsers, revokeSessionById, updateUserRole, AuthError } from "../services/authService";
import { listBackups, runBackup } from "../services/backupService";
import { requireAdmin } from "../middleware/requireAdmin";
import { ApiError } from "../middleware/errorHandler";

export const adminRouter = Router();

// requireAuth is applied globally in app.ts before this router is mounted;
// requireAdmin narrows it further to admins only.
adminRouter.get("/admin/sessions", requireAdmin, async (_req, res, next) => {
  try {
    const sessions = await listSessions();
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        email: s.user.email,
        role: s.user.role,
        ipAddress: s.ipAddress,
        active: s.active && s.expiresAt > new Date(),
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt,
      })),
      count: sessions.length,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/sessions/:id/revoke", requireAdmin, async (req, res, next) => {
  try {
    const revoked = await revokeSessionById(req.params.id);
    if (!revoked) return next(new ApiError(404, "Active session not found."));
    res.json({ revoked: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/admin/users", requireAdmin, async (_req, res, next) => {
  try {
    const users = await listUsers();
    res.json({
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        loginMethods: [user.passwordHash ? "password" : null, user.googleId ? "google" : null].filter(Boolean),
        sessionCount: user._count.sessions,
        alertCount: user._count.alertSentLogs,
        alertsActive: user.alertSubscription?.active ?? false,
        alertKeywords: user.alertSubscription?.keywords ?? [],
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
      count: users.length,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      email: z.string().trim().email("Enter a valid email address."),
      password: z.string().min(8, "Password must be at least 8 characters."),
      role: z.enum(["admin", "user"]).default("user"),
    }).parse(req.body ?? {});
    const user = await createUserByAdmin(input.email, input.password, input.role);
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof AuthError) return next(new ApiError(err.status, err.message));
    next(err);
  }
});

adminRouter.patch("/admin/users/:id/role", requireAdmin, async (req, res, next) => {
  try {
    const { role } = z.object({ role: z.enum(["admin", "user"]) }).parse(req.body ?? {});
    const user = await updateUserRole(req.params.id, role, req.user!.id);
    res.json(user);
  } catch (err) {
    if (err instanceof AuthError) return next(new ApiError(err.status, err.message));
    next(err);
  }
});

// Read-only -- listing existing backups is safe; restoring one is
// deliberately not exposed over HTTP at all (see scripts/restore-backup.ts).
adminRouter.get("/admin/backups", requireAdmin, async (_req, res, next) => {
  try {
    const backups = await listBackups();
    res.json({ backups, count: backups.length });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/backups/run", requireAdmin, async (_req, res, next) => {
  try {
    const { dir, counts } = await runBackup();
    res.json({ dir, counts });
  } catch (err) {
    next(err);
  }
});
