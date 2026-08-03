import { parseAssistedRows } from "../../src/services/assistedRowParser";

const irepsPortal: any = {
  key: "ireps",
  name: "Indian Railways E-Procurement System (IREPS)",
  baseUrl: "https://www.ireps.gov.in",
};

describe("IREPS assisted row parsing", () => {
  it("rejects navigation and script rows that previously became fake tenders", () => {
    const rows = [
      { cells: ["topStrip1", "About IREPS"], links: ["http://cris.org.in/"] },
      { cells: ["TESTING2", "Search Tender", "No Results Found"], links: ["https://www.ireps.gov.in"] },
    ];

    expect(parseAssistedRows(rows, irepsPortal)).toEqual([]);
  });

  it("accepts a real IREPS result row with a numeric tender reference", () => {
    const rows = [{
      cells: ["1", "CR-MUM-2026-12345", "Supply of thermal imaging camera", "Central Railway", "31/08/2026 15:00"],
      links: ["https://www.ireps.gov.in/epsn/viewTender.do?id=12345"],
    }];

    const result = parseAssistedRows(rows, irepsPortal);
    expect(result).toHaveLength(1);
    expect(result[0].tenderId).toBe("CR-MUM-2026-12345");
    expect(result[0].title).toContain("thermal imaging camera");
  });
});
