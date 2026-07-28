import fs from "fs";
import path from "path";
import { parseListingPage, detectBlockingPage } from "../../src/portals/adapters/gepnicParser";

const FIXTURES = path.join(__dirname, "..", "fixtures");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf-8");
}

describe("gepnicParser.parseListingPage", () => {
  const html = loadFixture("gepnic-latest-tenders.html");

  it("extracts every tender row from the fixture", () => {
    const rows = parseListingPage(html, "cppp", "https://eprocure.gov.in/eprocure/app", undefined);
    expect(rows).toHaveLength(3);
  });

  it("normalises each row into the PortalTender shape", () => {
    const rows = parseListingPage(html, "cppp", "https://eprocure.gov.in/eprocure/app");
    const first = rows.find((r) => r.tenderId === "IIPE/SnP/2025-26/09");
    expect(first).toBeDefined();
    expect(first!.portal).toBe("cppp");
    expect(first!.title).toContain("Hiring of Laundry Services");
    expect(first!.tenderURL).toContain("https://eprocure.gov.in");
    expect(first!.closingDate).toBeDefined();
    expect(new Date(first!.closingDate!).getUTCFullYear()).toBe(2026);
  });

  it("tags rows with the configured state/scope", () => {
    const rows = parseListingPage(html, "maharashtra", "https://mahatenders.gov.in/nicgep/app", "Maharashtra");
    expect(rows.every((r) => r.state === "Maharashtra")).toBe(true);
  });

  it("de-duplicates tenderId within a single page", () => {
    const rows = parseListingPage(html + html, "cppp", "https://eprocure.gov.in/eprocure/app");
    const ids = rows.map((r) => r.tenderId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns an empty array for a page with no tender rows", () => {
    const empty = loadFixture("gepnic-empty.html");
    expect(parseListingPage(empty, "cppp", "https://eprocure.gov.in/eprocure/app")).toEqual([]);
  });

  it("does not swallow nested-table cell text into the tenderId (real eprocure.gov.in capture)", () => {
    // This is a real captured eprocure.gov.in home page: a deeply nested
    // legacy table layout where several rows have a <table> nested inside
    // one of their <td>s. A row like that must be skipped rather than
    // treated as a tender whose "reference number" is its entire nested
    // table's rendered text.
    const nested = loadFixture("gepnic-nested-layout-tables.html");
    const rows = parseListingPage(nested, "cppp", "https://eprocure.gov.in/eprocure/app");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tenderId.length).toBeLessThan(200);
      expect(row.closingDate).toBeDefined();
    }
  });
});

describe("gepnicParser.detectBlockingPage", () => {
  it("flags a CAPTCHA page", () => {
    const captcha = loadFixture("gepnic-captcha.html");
    expect(detectBlockingPage(captcha)).toEqual({ blocked: true, reason: "captcha" });
  });

  it("does not flag a normal listing page", () => {
    const normal = loadFixture("gepnic-latest-tenders.html");
    expect(detectBlockingPage(normal).blocked).toBe(false);
  });
});
