import fs from "fs";
import path from "path";
import { parseOrganisationLinks, parseOrgTenderRows } from "../../src/portals/adapters/gepnicOrgParser";

const FIXTURES = path.join(__dirname, "..", "fixtures");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf-8");
}

describe("gepnicOrgParser.parseOrganisationLinks", () => {
  const html = loadFixture("gepnic-org-index.html");

  it("extracts organisation name, active-tender count, and a real link from the real eprocure.gov.in capture", () => {
    const links = parseOrganisationLinks(html, "https://eprocure.gov.in/eprocure/app");
    expect(links.length).toBeGreaterThan(0);
    const amu = links.find((l) => l.name === "Aligarh Muslim University");
    expect(amu).toBeDefined();
    expect(amu!.count).toBe(4);
    expect(amu!.url).toContain("https://eprocure.gov.in");
    expect(amu!.url).toContain("component=%24DirectLink");
  });

  it("returns an empty array for a page with no organisation table", () => {
    expect(parseOrganisationLinks("<html><body>nothing here</body></html>", "https://eprocure.gov.in/eprocure/app")).toEqual([]);
  });
});

describe("gepnicOrgParser.parseOrgTenderRows", () => {
  const html = loadFixture("gepnic-org-tenders.html");

  it("extracts every tender row from a real organisation tender-list capture", () => {
    const rows = parseOrgTenderRows(html, "cppp", "https://eprocure.gov.in/eprocure/app");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.portal === "cppp")).toBe(true);
  });

  it("splits the organisation chain and pulls the bracketed tender ID / reference number out of the title cell", () => {
    const rows = parseOrgTenderRows(html, "cppp", "https://eprocure.gov.in/eprocure/app");
    const first = rows[0];
    expect(first.title).toContain("Internal Electrification");
    expect(first.organisation).toBe("Aligarh Muslim University");
    expect(first.department).toBe("Electricity Department");
    expect(first.tenderId).toBeTruthy();
    expect(first.closingDate).toBeDefined();
    expect(new Date(first.closingDate!).getUTCFullYear()).toBe(2026);
  });

  it("tags rows with the configured state/scope", () => {
    const rows = parseOrgTenderRows(html, "maharashtra", "https://mahatenders.gov.in/nicgep/app", "Maharashtra");
    expect(rows.every((r) => r.state === "Maharashtra")).toBe(true);
  });

  it("returns an empty array for a page with no matching table", () => {
    expect(parseOrgTenderRows("<html><body>nothing here</body></html>", "cppp", "https://eprocure.gov.in/eprocure/app")).toEqual([]);
  });
});
