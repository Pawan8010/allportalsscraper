/**
 * This test asserts the (portal, tenderId) uniqueness contract at the
 * Prisma-schema level. It requires a real PostgreSQL instance reachable via
 * DATABASE_URL and is skipped automatically if that isn't configured (e.g.
 * in this sandbox, which has no outbound DB to connect to) -- it is meant to
 * run in CI / on a developer machine with a real Postgres, not as a fixture-
 * only unit test.
 */
import { PrismaClient } from "@prisma/client";

const hasDb = !!process.env.DATABASE_URL;
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("Tender (portal, tenderId) uniqueness", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { portal: "test_portal" } });
    await prisma.$disconnect();
  });

  it("rejects a duplicate (portal, tenderId) insert", async () => {
    const base = {
      portal: "test_portal",
      portalName: "Test Portal",
      tenderId: "DUPLICATE-1",
      title: "Test tender",
      tenderURL: "https://example.invalid/1",
      sourceUrl: "https://example.invalid/1",
      contentHash: "hash1",
    };
    await prisma.tender.create({ data: base });
    await expect(prisma.tender.create({ data: { ...base, title: "Different title, same key" } })).rejects.toThrow();
  });
});
