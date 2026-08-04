import { Router } from "express";
import { z } from "zod";
import { listSessions, listUsers, revokeSessionById } from "../services/authService";
import { listBackups, runBackup } from "../services/backupService";
import { requireAdmin } from "../middleware/requireAdmin";
import { ApiError } from "../middleware/errorHandler";
import { getPublicSmtpSettings, saveSmtpSettings } from "../services/smtpSettingsService";
import { sendSmtpTestEmail, verifySmtpConnection } from "../services/mailer";
import { runAlertCycle } from "../services/alertService";

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
        loginMethods: user.passwordHash ? ["password"] : [],
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

adminRouter.get("/admin/mail-settings", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getPublicSmtpSettings());
  } catch (err) {
    next(err);
  }
});

adminRouter.put("/admin/mail-settings", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      enabled: z.boolean(),
      host: z.string().trim().min(1),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      username: z.string().trim().min(1),
      password: z.string().optional(),
      fromEmail: z.string().trim().email(),
    }).parse(req.body ?? {});
    res.json(await saveSmtpSettings(input));
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/mail-settings/test", requireAdmin, async (req, res, next) => {
  try {
    const { to } = z.object({ to: z.string().trim().email() }).parse(req.body ?? {});
    await verifySmtpConnection();
    await sendSmtpTestEmail(to);
    res.json({ sent: true, to });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admin/alerts/run", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await runAlertCycle());
  } catch (err) {
    next(err);
  }
});
