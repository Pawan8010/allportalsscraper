import { Router } from "express";
import { listSessions } from "../services/authService";
import { listBackups, runBackup } from "../services/backupService";
import { requireAdmin } from "../middleware/requireAdmin";

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
