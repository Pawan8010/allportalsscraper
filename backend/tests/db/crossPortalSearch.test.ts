import { PrismaClient } from "@prisma/client";
import { searchTenders } from "../../src/services/searchService";

const hasDb = /^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL ?? "");
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("cross-portal structured reference search", () => {
  const prisma = new PrismaClient();
  const portal = "test_cross_portal";
  const tenderId = "2026_TEST_98765_1";
  const externalReference = "DEPT/UNIT/2026/42/PT2";

  beforeAll(async () => {
    await prisma.tender.upsert({
      where: { portal_tenderId: { portal, tenderId } },
      create: {
        portal,
        portalName: "Test Cross Portal",
        tenderId,
        title: "Test optical equipment tender",
        description: `Public reference: ${externalReference}`,
        closingDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        tenderURL: "https://example.invalid/tender",
        sourceUrl: "https://example.invalid/tender",
        contentHash: "cross-portal-search-fixture",
      },
      update: {
        description: `Public reference: ${externalReference}`,
        closingDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { portal } });
    await prisma.$disconnect();
  });

  it("finds an underscore-separated portal tender id exactly", async () => {
    const result = await searchTenders({ q: tenderId, limit: 10 });
    expect(result.rows[0]).toMatchObject({ portal, tenderId });
    expect(result.total).toBe(1);
  });

  it("finds a slash-separated reference stored in the description", async () => {
    const result = await searchTenders({ q: externalReference, limit: 10 });
    expect(result.rows[0]).toMatchObject({ portal, tenderId });
    expect(result.total).toBe(1);
  });
});
