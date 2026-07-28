import fs from "fs";
import path from "path";
import { mapGemBid, mapGemBidPage } from "../../src/portals/adapters/gemApiParser";

const FIXTURES = path.join(__dirname, "..", "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf-8"));
}

describe("gemApiParser.mapGemBidPage", () => {
  const docs = loadFixture("gem-all-bids-data.json");

  it("maps every doc from a real bidplus.gem.gov.in/all-bids-data capture", () => {
    const tenders = mapGemBidPage(docs);
    expect(tenders.length).toBeGreaterThan(0);
    expect(tenders.every((t) => t.portal === "gem")).toBe(true);
  });

  it("normalises a known bid, preferring the untruncated item list and building the right document URL", () => {
    const tenders = mapGemBidPage(docs);
    const first = tenders.find((t) => t.tenderId === "GEM/2026/B/7594220");
    expect(first).toBeDefined();
    expect(first!.title).toContain("OFFLOADING OF ANNUAL CLASS SURVEY");
    expect(first!.department).toBe("Department of Military Affairs");
    expect(first!.organisation).toBe("Ministry of Defence");
    expect(first!.tenderURL).toBe("https://bidplus.gem.gov.in/showbidDocument/9389707");
    expect(first!.publishedDate).toBe("2026-05-27T18:47:41.000Z");
    expect(first!.closingDate).toBeDefined();
  });

  it("returns null for a doc with no bid number or title", () => {
    expect(mapGemBid({})).toBeNull();
    expect(mapGemBid({ b_bid_number: ["GEM/2026/B/1"] })).toBeNull();
  });

  it("returns an empty array for a non-array input", () => {
    expect(mapGemBidPage(null)).toEqual([]);
    expect(mapGemBidPage({ code: 404 })).toEqual([]);
  });
});
