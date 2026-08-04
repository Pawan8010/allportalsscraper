/**
 * Restores the database from a backup folder created by backupService.ts.
 * Deliberately NOT an API route or a UI button -- this overwrites live
 * data, so it only runs as an explicit, manual, confirm-gated CLI command.
 *
 * Usage:
 *   npx ts-node scripts/restore-backup.ts <backup-folder-name> --confirm
 *
 * Example:
 *   npx ts-node scripts/restore-backup.ts 2026-07-29T12-00-00-000Z --confirm
 *
 * List available backups first with: ls backend/backups
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/services/prisma";
import { logger } from "../src/utils/logger";

const BACKUP_ROOT = path.join(__dirname, "..", "backups");

interface ModelHandle {
  name: string;
  deleteMany: () => Promise<unknown>;
  createMany: (data: unknown[]) => Promise<unknown>;
}

// Parent-first order: User has no dependencies of its own; Session,
// AlertSubscription, and AlertSentLog all carry a userId FK, so User must
// already exist before any of them are (re)created. Tender/ScrapeRun have
// no FKs at all, so their position relative to the others doesn't matter.
const MODELS_PARENT_FIRST: ModelHandle[] = [
  { name: "User", deleteMany: () => prisma.user.deleteMany(), createMany: (data) => prisma.user.createMany({ data: data as never[] }) },
  { name: "Tender", deleteMany: () => prisma.tender.deleteMany(), createMany: (data) => prisma.tender.createMany({ data: data as never[] }) },
  { name: "ScrapeRun", deleteMany: () => prisma.scrapeRun.deleteMany(), createMany: (data) => prisma.scrapeRun.createMany({ data: data as never[] }) },
  { name: "Session", deleteMany: () => prisma.session.deleteMany(), createMany: (data) => prisma.session.createMany({ data: data as never[] }) },
  { name: "AlertSubscription", deleteMany: () => prisma.alertSubscription.deleteMany(), createMany: (data) => prisma.alertSubscription.createMany({ data: data as never[] }) },
  { name: "AlertSentLog", deleteMany: () => prisma.alertSentLog.deleteMany(), createMany: (data) => prisma.alertSentLog.createMany({ data: data as never[] }) },
  { name: "ExpiredTender", deleteMany: () => prisma.expiredTender.deleteMany(), createMany: (data) => prisma.expiredTender.createMany({ data: data as never[] }) },
  { name: "SmtpSettings", deleteMany: () => prisma.smtpSettings.deleteMany(), createMany: (data) => prisma.smtpSettings.createMany({ data: data as never[] }) },
];

async function main() {
  const [folderName, confirmFlag] = process.argv.slice(2);
  if (!folderName || confirmFlag !== "--confirm") {
    console.error(
      "Usage: npx ts-node scripts/restore-backup.ts <backup-folder-name> --confirm\n" +
        "This OVERWRITES all current data in the tables it restores. The --confirm flag is required on purpose."
    );
    process.exit(1);
  }

  const dir = path.join(BACKUP_ROOT, folderName);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    console.error(`No backup folder found at ${dir}`);
    process.exit(1);
  }

  // Clear existing data child-first (reverse of the parent-first order) so
  // no delete ever violates a still-present foreign key.
  for (const model of [...MODELS_PARENT_FIRST].reverse()) {
    await model.deleteMany().catch(() => undefined);
  }

  // Reload parent-first, so every foreign key a row points at already
  // exists by the time that row is inserted.
  for (const model of MODELS_PARENT_FIRST) {
    const file = path.join(dir, `${model.name}.json`);
    const raw = await fs.readFile(file, "utf8").catch(() => null);
    if (raw === null) {
      logger.warn({ model: model.name }, "no backup file for this model, skipping");
      continue;
    }
    const rows = JSON.parse(raw) as unknown[];
    if (rows.length === 0) continue;
    await model.createMany(rows);
    logger.info({ model: model.name, count: rows.length }, "restored");
  }

  logger.info({ dir }, "restore complete");
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "restore failed");
  process.exit(1);
});
