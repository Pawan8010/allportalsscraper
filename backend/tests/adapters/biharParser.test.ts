import fs from "fs";
import path from "path";
import { mapBiharTenderList, mapBiharTender } from "../../src/portals/adapters/biharParser";

const FIXTURES = path.join(__dirname, "..", "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf-8"));
}

describe("biharParser.mapBiharTenderList", () => {
  const rows = loadFixture("bihar-tender-list.json");

  it("maps every row from the real API capture into the PortalTender shape", () => {
    const tenders = mapBiharTenderList(rows);
    expect(tenders.length).toBeGreaterThan(0);
    expect(tenders.every((t) => t.portal === "bihar" && t.state === "Bihar")).toBe(true);
  });

  it("prefers the org-facing tender number and converts epoch-ms dates to ISO", () => {
    const tenders = mapBiharTenderList(rows);
    const first = tenders[0];
    expect(first.tenderId).toBe("136279");
    expect(first.title).toContain("CONSTRUCTION OF DRAIN");
    expect(first.closingDate).toBeDefined();
    expect(new Date(first.closingDate!).getUTCFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it("returns an empty array for a non-array response instead of throwing", () => {
    expect(mapBiharTenderList({ error: "not found" })).toEqual([]);
    expect(mapBiharTenderList(null)).toEqual([]);
  });

  it("drops a row with no description or tender id rather than guessing", () => {
    expect(mapBiharTender({})).toBeNull();
    expect(mapBiharTender({ currentdescription: "Only a title, no id" })).toBeNull();
  });
});
