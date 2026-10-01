import { normalizeQuery } from "../../src/services/searchService";
import { expandAliases } from "../../src/services/searchAliases";

describe("normalizeQuery", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeQuery("  Thermal   Weapon Sight  ")).toBe("thermal weapon sight");
  });

  it("keeps reference-number punctuation like / and -", () => {
    expect(normalizeQuery("IIPE/SnP/2025-26/09")).toBe("iipe/snp/2025-26/09");
  });

  it("keeps underscores used by non-GeM tender references", () => {
    expect(normalizeQuery("2026_HFWD_53002_1")).toBe("2026_hfwd_53002_1");
  });

  it("strips other punctuation", () => {
    expect(normalizeQuery("Night Vision Goggles (NVG)!!")).toBe("night vision goggles nvg");
  });

  it("applies Unicode NFKC normalisation", () => {
    // Full-width characters should normalise to their ASCII equivalents.
    expect(normalizeQuery("ＮＶＧ")).toBe("nvg");
  });
});

describe("expandAliases", () => {
  it("expands a known acronym to its spelled-out form", () => {
    expect(expandAliases("nvg")).toEqual(["nvg", "night vision goggles"]);
  });

  it("passes through unknown terms unchanged", () => {
    expect(expandAliases("bulldozer")).toEqual(["bulldozer"]);
  });
});
