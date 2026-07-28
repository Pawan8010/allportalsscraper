import { PrismaClient } from "@prisma/client";
import { config } from "./env";

// Reuse a single PrismaClient across hot reloads in dev to avoid
// exhausting the Postgres connection pool.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: config.nodeEnv === "development" ? ["warn", "error"] : ["error"],
  });

if (config.nodeEnv !== "production") {
  global.__prisma = prisma;
}

export async function connectDb(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
