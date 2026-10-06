require("dotenv").config({ path: __dirname + "/../.env" });
const { startScrapeAllInBackground } = require("../dist/services/portalScrapeService.js");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function run() {
  console.log("Triggering massive full scrape across all 23+ portals...");
  const runId = await startScrapeAllInBackground("full");
  console.log("Full sweep started! Run ID:", runId);
}

run().catch(console.error).finally(() => prisma.$disconnect());
