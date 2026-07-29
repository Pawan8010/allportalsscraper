import { Router } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma";

export const alertsRouter = Router();

const subscriptionSchema = z.object({
  keywords: z.array(z.string().trim().min(1)).max(50),
  active: z.boolean().default(true),
});

// requireAuth is applied globally in app.ts before this router is mounted,
// so req.user is always set here.

alertsRouter.get("/alerts/subscription", async (req, res, next) => {
  try {
    const sub = await prisma.alertSubscription.findUnique({ where: { userId: req.user!.id } });
    res.json(sub ?? { keywords: [], active: false });
  } catch (err) {
    next(err);
  }
});

alertsRouter.put("/alerts/subscription", async (req, res, next) => {
  try {
    const { keywords, active } = subscriptionSchema.parse(req.body ?? {});
    const sub = await prisma.alertSubscription.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, keywords, active },
      update: { keywords, active },
    });
    res.json(sub);
  } catch (err) {
    next(err);
  }
});

alertsRouter.get("/alerts/history", async (req, res, next) => {
  try {
    const history = await prisma.alertSentLog.findMany({
      where: { userId: req.user!.id },
      orderBy: { sentAt: "desc" },
      take: 100,
    });
    res.json({ history, count: history.length });
  } catch (err) {
    next(err);
  }
});
