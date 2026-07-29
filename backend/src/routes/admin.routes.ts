import { Router } from "express";
import { listSessions } from "../services/authService";
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
