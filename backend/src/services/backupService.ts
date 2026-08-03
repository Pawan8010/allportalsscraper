import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { logger } from "../utils/logger";
import { env } from "../config/env";

const BACKUP_ROOT = path.join(__dirname, "..", "..", "backups");
const BATCH_SIZE = 5000;

// Prisma delegates for every model worth backing up. Kept as a plain
// function-per-model (not a generic "walk all models" loop) so a future
// model addition is a deliberate one-line choice, not something silently
// swept in or left out.
const MODELS: { name: string; findMany: (args: { skip: number; take: number }) => Promise<unknown[]> }[] = [
  { name: "Tender", findMany: (a) => prisma.tender.findMany({ ...a, orderBy: { id: "asc" } }) },
  { name: "ScrapeRun", findMany: (a) => prisma.scrapeRun.findMany({ ...a, orderBy: { id: "asc" } }) },
  { name: "User", findMany: (a) => prisma.user.findMany({ ...a, orderBy: { id: "asc" } }) },
  { name: "Session", findMany: (a) => prisma.session.findMany({ ...a, orderBy: { id: "asc" } }) },
  { name: "AlertSubscription", findMany: (a) => prisma.alertSubscription.findMany({ ...a, orderBy: { id: "asc" } }) },
  { name: "AlertSentLog", findMany: (a) => prisma.alertSentLog.findMany({ ...a, orderBy: { id: "asc" } }) },
  { name: "ExpiredTender", findMany: (a) => prisma.expiredTender.findMany({ ...a, orderBy: { id: "asc" } }) },
];

async function backupModel(dir: string, model: (typeof MODELS)[number]): Promise<number> {
  const rows: unknown[] = [];
  for (let skip = 0; ; skip += BATCH_SIZE) {
    const batch = await model.findMany({ skip, take: BATCH_SIZE });
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < BATCH_SIZE) break;
  }
  await fs.writeFile(path.join(dir, `${model.name}.json`), JSON.stringify(rows));
  return rows.length;
}

/** Exports every backed-up table to a fresh timestamped folder under backend/backups/. */
export async function runBackup(): Promise<{ dir: string; counts: Record<string, number> }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(BACKUP_ROOT, stamp);
  await fs.mkdir(dir, { recursive: true });

  const counts: Record<string, number> = {};
  for (const model of MODELS) {
    counts[model.name] = await backupModel(dir, model);
  }

  logger.info({ dir, counts }, "backup complete");
  return { dir, counts };
}

/** Deletes backup folders older than BACKUP_RETENTION_DAYS, keeping storage bounded. */
export async function pruneOldBackups(): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(BACKUP_ROOT);
  } catch {
    return 0; // no backups directory yet -- nothing to prune
  }

  const cutoff = Date.now() - env.backupRetentionDays * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const entry of entries) {
    const full = path.join(BACKUP_ROOT, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (stat?.isDirectory() && stat.birthtimeMs < cutoff) {
      await fs.rm(full, { recursive: true, force: true });
      pruned += 1;
    }
  }
  if (pruned > 0) logger.info({ pruned }, "pruned old backups");
  return pruned;
}

export interface BackupSummary {
  name: string;
  createdAt: string;
  sizeBytes: number;
}

/** Read-only listing for the admin UI -- never used to trigger a restore. */
export async function listBackups(): Promise<BackupSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(BACKUP_ROOT);
  } catch {
    return [];
  }

  const summaries: BackupSummary[] = [];
  for (const entry of entries) {
    const full = path.join(BACKUP_ROOT, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isDirectory()) continue;
    let sizeBytes = 0;
    const files = await fs.readdir(full).catch(() => []);
    for (const file of files) {
      const fileStat = await fs.stat(path.join(full, file)).catch(() => null);
      sizeBytes += fileStat?.size ?? 0;
    }
    summaries.push({ name: entry, createdAt: stat.birthtime.toISOString(), sizeBytes });
  }
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
