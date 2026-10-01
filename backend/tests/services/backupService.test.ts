const writtenFiles: Record<string, string> = {};
let mkdirCalls: string[] = [];
let readdirResult: string[] = [];
let statResults: Record<string, { isDirectory: () => boolean; birthtimeMs: number; birthtime: Date; size?: number }> = {};
let rmCalls: string[] = [];

jest.mock("node:fs/promises", () => ({
  mkdir: jest.fn(async (dir: string) => {
    mkdirCalls.push(dir);
  }),
  writeFile: jest.fn(async (file: string, content: string) => {
    writtenFiles[file] = content;
  }),
  readdir: jest.fn(async () => readdirResult),
  stat: jest.fn(async (p: string) => {
    const result = statResults[p];
    if (!result) throw new Error("ENOENT");
    return result;
  }),
  rm: jest.fn(async (dir: string) => {
    rmCalls.push(dir);
  }),
}));

let tenders: any[] = [];
let scrapeRuns: any[] = [];

jest.mock("../../src/services/prisma", () => ({
  prisma: {
    tender: { findMany: jest.fn(async ({ skip, take }: any) => tenders.slice(skip, skip + take)) },
    scrapeRun: { findMany: jest.fn(async ({ skip, take }: any) => scrapeRuns.slice(skip, skip + take)) },
    user: { findMany: jest.fn(async () => []) },
    session: { findMany: jest.fn(async () => []) },
    alertSubscription: { findMany: jest.fn(async () => []) },
    alertSentLog: { findMany: jest.fn(async () => []) },
    expiredTender: { findMany: jest.fn(async () => []) },
    smtpSettings: { findMany: jest.fn(async () => []) },
  },
}));

jest.mock("../../src/config/env", () => ({ env: { backupRetentionDays: 14, logLevel: "silent" } }));

import { runBackup, pruneOldBackups, listBackups } from "../../src/services/backupService";

describe("backupService", () => {
  beforeEach(() => {
    Object.keys(writtenFiles).forEach((k) => delete writtenFiles[k]);
    mkdirCalls = [];
    readdirResult = [];
    statResults = {};
    rmCalls = [];
    tenders = [];
    scrapeRuns = [];
  });

  describe("runBackup", () => {
    it("writes one JSON file per model and reports accurate counts", async () => {
      tenders = [{ id: "t1" }, { id: "t2" }];
      scrapeRuns = [{ id: "r1" }];

      const { counts } = await runBackup();

      expect(counts.Tender).toBe(2);
      expect(counts.ScrapeRun).toBe(1);
      expect(counts.User).toBe(0);
      expect(counts.ExpiredTender).toBe(0);
      expect(counts.SmtpSettings).toBe(0);
      expect(mkdirCalls.length).toBe(1);

      const tenderFile = Object.keys(writtenFiles).find((f) => f.endsWith("Tender.json"));
      expect(tenderFile).toBeDefined();
      expect(JSON.parse(writtenFiles[tenderFile!])).toEqual(tenders);
    });

    it("paginates across multiple batches for a large table", async () => {
      // Simulate more rows than a single batch by making findMany aware of
      // its own take size and returning until exhausted -- already covered
      // by slice(skip, skip+take) against a big fixture.
      tenders = Array.from({ length: 12000 }, (_, i) => ({ id: `t${i}` }));

      const { counts } = await runBackup();
      expect(counts.Tender).toBe(12000);
    });
  });

  describe("pruneOldBackups", () => {
    it("removes only folders older than the retention window", async () => {
      const now = Date.now();
      readdirResult = ["old-backup", "recent-backup", "not-a-dir.txt"];

      // backupService resolves BACKUP_ROOT relative to its own module
      // location, so match stat() calls by basename rather than a full path.
      const fsp = require("node:fs/promises");
      (fsp.stat as jest.Mock).mockImplementation(async (p: string) => {
        if (p.endsWith("old-backup")) {
          const t = now - 20 * 24 * 60 * 60 * 1000;
          return { isDirectory: () => true, birthtimeMs: t, birthtime: new Date(t) };
        }
        if (p.endsWith("recent-backup")) {
          const t = now - 1 * 24 * 60 * 60 * 1000;
          return { isDirectory: () => true, birthtimeMs: t, birthtime: new Date(t) };
        }
        if (p.endsWith("not-a-dir.txt")) {
          return { isDirectory: () => false, birthtimeMs: now, birthtime: new Date(now) };
        }
        throw new Error("ENOENT");
      });

      const pruned = await pruneOldBackups();

      expect(pruned).toBe(1);
      expect(rmCalls.some((p) => p.endsWith("old-backup"))).toBe(true);
      expect(rmCalls.some((p) => p.endsWith("recent-backup"))).toBe(false);
    });

    it("returns 0 without throwing when the backups directory doesn't exist yet", async () => {
      const fsp = require("node:fs/promises");
      (fsp.readdir as jest.Mock).mockRejectedValueOnce(new Error("ENOENT"));
      expect(await pruneOldBackups()).toBe(0);
    });
  });

  describe("listBackups", () => {
    it("returns an empty list when the backups directory doesn't exist yet", async () => {
      const fsp = require("node:fs/promises");
      (fsp.readdir as jest.Mock).mockRejectedValueOnce(new Error("ENOENT"));
      expect(await listBackups()).toEqual([]);
    });
  });
});
