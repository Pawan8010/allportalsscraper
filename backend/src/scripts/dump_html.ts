import { chromium } from "playwright";
import fs from "fs";

async function main() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log("Navigating to https://bidplus.gem.gov.in/all-bids...");
  await page.goto("https://bidplus.gem.gov.in/all-bids", { waitUntil: "networkidle" });
  
  console.log("Waiting a few seconds for JS to render...");
  await page.waitForTimeout(5000);
  
  const html = await page.content();
  fs.writeFileSync("scratch.html", html, "utf-8");
  
  console.log("HTML saved to scratch.html");
  await browser.close();
}

main().catch(console.error);
