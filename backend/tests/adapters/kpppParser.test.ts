import fs from "fs";
import path from "path";
import { mapKpppTenderList, mapKpppTender, parseKpppDate } from "../../src/portals/adapters/kpppParser";

const FIXTURES = path.join(__dirname, "..", "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf-8"));
}

describe("kpppParser.mapKpppTenderList", () => {
  const rows = loadFixture("kppp-goods-tenders.json");

  it("maps every row from a real API capture into the PortalTender shape", () => {
    const tenders = mapKpppTenderList(rows);
    expect(tenders).toHaveLength(3);
    expect(tenders.every((t) => t.portal === "karnataka" && t.state === "Karnataka")).toBe(true);
  });

  it("uses the tenderNumber as tenderId and preserves department/category", () => {
    const tenders = mapKpppTenderList(rows);
    const first = tenders[0];
    expect(first.tenderId).toBe("DMA/2026-27/IND6413");
    expect(first.title).toContain("De silting Vehicle");
    expect(first.department).toBe("Directorate of Municipal Administration");
    expect(first.category).toBe("Goods");
    expect(first.closingDate).toBe(new Date(Date.UTC(2026, 7, 5, 16, 0, 0)).toISOString());
  });

  it("returns an empty array for a non-array response instead of throwing", () => {
    expect(mapKpppTenderList({ error: "bad request" })).toEqual([]);
    expect(mapKpppTenderList(null)).toEqual([]);
  });

  it("drops a row with no tender number/id or title rather than guessing", () => {
    expect(mapKpppTender({ id: 1, title: "" })).toBeNull();
    expect(mapKpppTender({ id: 0, tenderNumber: "", title: "Only a title" })).toBeNull();
  });

  it("falls back to the numeric id when tenderNumber is missing", () => {
    const tender = mapKpppTender({ id: 42, title: "Some tender" });
    expect(tender?.tenderId).toBe("42");
  });
});

describe("kpppParser.parseKpppDate", () => {
  it("parses a 24-hour DD-MM-YYYY HH:MM:SS string", () => {
    const date = parseKpppDate("27-07-2026 18:28:18");
    expect(date?.toISOString()).toBe(new Date(Date.UTC(2026, 6, 27, 18, 28, 18)).toISOString());
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(parseKpppDate("not a date")).toBeNull();
    expect(parseKpppDate(null)).toBeNull();
  });
});
