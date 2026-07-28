import fs from "fs";
import path from "path";
import {
  extractTenderCounts,
  parseClosingReport,
  parseGujaratReportDate,
} from "../../src/portals/adapters/gujaratNprocureParser";

const FIXTURES = path.join(__dirname, "..", "fixtures");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf-8");
}

describe("gujaratNprocureParser.extractTenderCounts", () => {
  it("parses the embedded tenderCounts JSON from a real capture", () => {
    const html = loadFixture("gujarat-closing-calendar.html");
    const counts = extractTenderCounts(html);
    expect(counts["2026-07-30"]).toBe(545);
    expect(counts["2026-07-01"]).toBe(187);
    expect(Object.keys(counts)).toHaveLength(25);
  });

  it("returns an empty object when no tenderCounts script is present", () => {
    expect(extractTenderCounts("<html></html>")).toEqual({});
  });
});

describe("gujaratNprocureParser.parseClosingReport", () => {
  it("parses every tender from a real capture, grouped under the right org/department", () => {
    const html = loadFixture("gujarat-closing-report.html");
    const tenders = parseClosingReport(html, "gujarat_nprocure");
    expect(tenders).toHaveLength(5);
    expect(tenders.every((t) => t.portal === "gujarat_nprocure" && t.state === "Gujarat")).toBe(true);

    const first = tenders[0];
    expect(first.tenderId).toBe("27/2026-27/CNCD/AMC");
    expect(first.organisation).toBe("Ahmedabad Municipal Corporation");
    expect(first.department).toContain("Cattle Nuisance Control Department");
    expect(first.closingDate).toBe(new Date(Date.UTC(2026, 6, 30, 15, 0)).toISOString());

    const fourth = tenders[3];
    expect(fourth.organisation).toBe("Dakshin Gujarat Vij Company Ltd. (DGVCL)");
    expect(fourth.tenderId).toBe("E-Tender Notice No.14/2026-27/Ankleshwar");
  });

  it("returns an empty array for HTML with no tender rows", () => {
    expect(parseClosingReport("<html><body>no data</body></html>", "gujarat_nprocure")).toEqual([]);
  });
});

describe("gujaratNprocureParser.parseGujaratReportDate", () => {
  it("parses a 24-hour DD-MM-YYYY HH:MM string", () => {
    const date = parseGujaratReportDate("30-07-2026 15:00");
    expect(date?.toISOString()).toBe(new Date(Date.UTC(2026, 6, 30, 15, 0)).toISOString());
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(parseGujaratReportDate("not a date")).toBeNull();
    expect(parseGujaratReportDate(null)).toBeNull();
  });
});
