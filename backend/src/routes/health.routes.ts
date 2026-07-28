import { Router } from "express";
import { prisma } from "../services/prisma";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected", time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: "error", database: "unreachable", message: String(err) });
  }
});
