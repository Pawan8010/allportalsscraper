import fs from "fs";
import path from "path";
import {
  parseCsrfBootstrapListing,
  parseCorrigendumJson,
  parseSlashDate,
  parseSplitClosingDate,
} from "../../src/portals/adapters/csrfBootstrapParser";

const FIXTURES = path.join(__dirname, "..", "fixtures");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf-8");
}

describe("csrfBootstrapParser.parseCsrfBootstrapListing", () => {
  it("parses Andhra Pradesh's .samer markup from a real capture", () => {
    const html = loadFixture("andhrapradesh-tender-listing.html");
    const tenders = parseCsrfBootstrapListing(html, "andhrapradesh", "Andhra Pradesh", "https://tender.apeprocurement.gov.in/");
    expect(tenders).toHaveLength(3);
    expect(tenders.every((t) => t.portal === "andhrapradesh" && t.state === "Andhra Pradesh")).toBe(true);

    const first = tenders[0];
    expect(first.tenderId).toBe("Nit No.109/MPLADS Dt.01.07.2026 of EE PRI, PKD 1st call");
    expect(first.title).toBe("MPLADS");
    expect(first.department).toBe("Executive Engineer, PRI Division, Penukonda");
    expect(first.closingDate).toBe(new Date(Date.UTC(2026, 7, 3, 17, 0)).toISOString());
  });

  it("parses Telangana's .update-nag markup from a real capture", () => {
    const html = loadFixture("telangana-tender-listing.html");
    const tenders = parseCsrfBootstrapListing(html, "telangana", "Telangana", "https://tender.telangana.gov.in/");
    expect(tenders).toHaveLength(3);
    expect(tenders.every((t) => t.portal === "telangana" && t.state === "Telangana")).toBe(true);

    const first = tenders[0];
    expect(first.tenderId).toBe("E0926O0086");
    expect(first.title).toContain("Procurement of Ordinary Portland Cement");
    expect(first.department).toBe("Corp-MP");
    expect(first.closingDate).toBeDefined();
  });

  it("de-duplicates tenders sharing the same tenderId", () => {
    const html = loadFixture("andhrapradesh-tender-listing.html") + loadFixture("andhrapradesh-tender-listing.html");
    const tenders = parseCsrfBootstrapListing(html, "andhrapradesh", "Andhra Pradesh", "https://tender.apeprocurement.gov.in/");
    expect(tenders).toHaveLength(3);
  });

  it("returns an empty array for HTML with neither known markup shape", () => {
    expect(parseCsrfBootstrapListing("<html><body>no tenders here</body></html>", "andhrapradesh", "Andhra Pradesh", "https://x/")).toEqual([]);
  });
});

describe("csrfBootstrapParser.parseCorrigendumJson", () => {
  it("parses every record from a real capture of Telangana's corrigendum AJAX endpoint", () => {
    const raw = loadFixture("telangana-corrigendum.json");
    const tenders = parseCorrigendumJson(raw, "telangana", "Telangana", "https://tender.telangana.gov.in/");
    expect(tenders).toHaveLength(3);
    expect(tenders.every((t) => t.portal === "telangana" && t.state === "Telangana")).toBe(true);

    const first = tenders[0];
    expect(first.tenderId).toBe("03/2026-27/PJHES/SE/O&M/JHEP/H61");
    expect(first.title).toBe("JHEP( PJHES & LJHES)");
    expect(first.department).toBe("TELANGANA POWER GENERATION CORPORATION LIMITED");
    expect(first.estimatedValue).toBe(190000);
    expect(first.closingDate).toBe(new Date(Date.UTC(2026, 7, 6, 15, 30)).toISOString());
  });

  it("omits estimatedValue when the source reports zero (not a real estimate)", () => {
    const raw = loadFixture("telangana-corrigendum.json");
    const tenders = parseCorrigendumJson(raw, "telangana", "Telangana", "https://tender.telangana.gov.in/");
    const zeroEstimate = tenders.find((t) => t.tenderId.startsWith("NIT NO.SE/TW"));
    expect(zeroEstimate?.estimatedValue).toBeUndefined();
  });

  it("returns an empty array for invalid JSON or a non-array payload instead of throwing", () => {
    expect(parseCorrigendumJson("not json", "telangana", "Telangana", "https://x/")).toEqual([]);
    expect(parseCorrigendumJson('{"error":"not found"}', "telangana", "Telangana", "https://x/")).toEqual([]);
  });
});

describe("csrfBootstrapParser.parseSlashDate", () => {
  it("parses a DD/MM/YYYY HH:MM AM/PM string with an explicit year", () => {
    const date = parseSlashDate("03/08/2026 05:00 PM");
    expect(date?.toISOString()).toBe(new Date(Date.UTC(2026, 7, 3, 17, 0)).toISOString());
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(parseSlashDate("not a date")).toBeNull();
    expect(parseSlashDate(null)).toBeNull();
    expect(parseSlashDate(undefined)).toBeNull();
  });
});

describe("csrfBootstrapParser.parseSplitClosingDate", () => {
  it("infers the current year when the month/day hasn't passed yet", () => {
    const now = new Date(Date.UTC(2026, 6, 1)); // 1 Jul 2026
    const date = parseSplitClosingDate("August", "11", "05:00 PM", now);
    expect(date?.getUTCFullYear()).toBe(2026);
    expect(date?.getUTCMonth()).toBe(7);
    expect(date?.getUTCDate()).toBe(11);
  });

  it("rolls over to next year when the month/day has already passed", () => {
    const now = new Date(Date.UTC(2026, 11, 20)); // 20 Dec 2026
    const date = parseSplitClosingDate("January", "5", "10:00 AM", now);
    expect(date?.getUTCFullYear()).toBe(2027);
    expect(date?.getUTCMonth()).toBe(0);
  });

  it("returns null for an unrecognised month name", () => {
    expect(parseSplitClosingDate("Notamonth", "5", "10:00 AM")).toBeNull();
  });
});
