import { describe, expect, it } from "vitest";
import {
  normalizeText,
  normalizeUnicode,
  normalizePhrase,
  normalizeQuery,
  normalizeKeywordSelection,
  singularize,
  expandAliases,
  extractBidNumber,
  buildTsQuery,
  trigramTokens,
} from "../src/search/normalize";

describe("normalizeUnicode", () => {
  it("strips diacritics and normalises exotic whitespace", () => {
    expect(normalizeUnicode("thérmal camera")).toBe("thermal camera");
  });

  it("folds every dash variant to a plain hyphen", () => {
    expect(normalizeUnicode("day–night")).toBe("day-night");
    expect(normalizeUnicode("day−night")).toBe("day-night");
  });

  it("folds smart quotes to ASCII", () => {
    expect(normalizeUnicode("“night”")).toBe('"night"');
  });
});

describe("normalizeText", () => {
  it("lowercases, collapses whitespace and trims", () => {
    expect(normalizeText("  THERMAL    Camera  ")).toBe("thermal camera");
  });

  it("turns hyphens, slashes and dots into spaces", () => {
    expect(normalizeText("LWIR/MWIR")).toBe("lwir mwir");
    expect(normalizeText("day-night sight")).toBe("day night sight");
    expect(normalizeText("P.T.Z. camera")).toBe("p t z camera");
  });

  it("removes harmless punctuation", () => {
    expect(normalizeText("Night Vision Goggles (NVG)!")).toBe("night vision goggles nvg");
  });

  it("is case insensitive - different cases normalise identically", () => {
    expect(normalizeText("ThErMaL CaMeRa")).toBe(normalizeText("thermal camera"));
  });
});

describe("singularize", () => {
  it("handles regular plurals", () => {
    expect(singularize("cameras")).toBe("camera");
    expect(singularize("sights")).toBe("sight");
    expect(singularize("goggles")).toBe("goggle");
  });

  it("handles -ies and -ves", () => {
    expect(singularize("batteries")).toBe("battery");
    expect(singularize("knives")).toBe("knif");
  });

  it("singularises plurals of words ending in a vowel + s", () => {
    // Regression: an "as$" guard used to leave these untouched, so
    // "thermal cameras" stopped matching "thermal camera".
    expect(singularize("cameras")).toBe("camera");
    expect(singularize("antennas")).toBe("antenna");
  });

  it("leaves words that only look plural alone", () => {
    expect(singularize("lens")).toBe("lens");
    expect(singularize("gas")).toBe("gas");
    expect(singularize("analysis")).toBe("analysis");
    expect(singularize("apparatus")).toBe("apparatus");
  });

  it("leaves very short tokens alone", () => {
    expect(singularize("eos")).toBe("eos");
  });
});

describe("normalizeQuery", () => {
  it("produces a canonical singular form", () => {
    expect(normalizeQuery("Thermal Cameras").canonical).toBe("thermal camera");
  });

  it("normalises spelling mistakes", () => {
    expect(normalizeQuery("thermla camrea").canonical).toBe("thermal camera");
    expect(normalizeQuery("weapon slight").canonical).toBe("weapon sight");
    expect(normalizeQuery("surveilance camera").canonical).toBe("surveillance camera");
  });

  it("collapses punctuation, hyphens and case into one canonical form", () => {
    const forms = ["Thermal-Camera", "thermal   camera", "THERMAL, CAMERA", "thermal cameras"];
    for (const form of forms) {
      expect(normalizeQuery(form).canonical).toBe("thermal camera");
    }
  });

  it("drops stop words from tokens but keeps them in allTokens", () => {
    const query = normalizeQuery("supply of thermal camera");
    expect(query.tokens).toEqual(["thermal", "camera"]);
    expect(query.allTokens).toContain("of");
  });

  it("detects a GeM bid number", () => {
    const query = normalizeQuery("GEM/2026/B/7755763");
    expect(query.isBidNumber).toBe(true);
    expect(query.bidNumber).toBe("GEM/2026/B/7755763");
  });

  it("returns an empty canonical for blank input", () => {
    expect(normalizeQuery("   ").canonical).toBe("");
  });
});

describe("extractBidNumber", () => {
  it("normalises separators and case to GeM's canonical form", () => {
    expect(extractBidNumber("gem-2026-b-7755763")).toBe("GEM/2026/B/7755763");
    expect(extractBidNumber("GEM 2026 R 704682")).toBe("GEM/2026/R/704682");
  });

  it("finds a bid number embedded in a sentence", () => {
    expect(extractBidNumber("please open GEM/2026/B/7755763 today")).toBe("GEM/2026/B/7755763");
  });

  it("accepts a bare long numeric id", () => {
    expect(extractBidNumber("7755763")).toBe("7755763");
  });

  it("returns null for ordinary text and short numbers", () => {
    expect(extractBidNumber("thermal camera")).toBeNull();
    expect(extractBidNumber("1234")).toBeNull();
  });
});

describe("expandAliases", () => {
  const expectsAlias = (query: string, expected: string) => {
    expect(expandAliases(normalizeQuery(query).canonical)).toContain(expected);
  };

  it("links every phrase the brief lists for thermal imaging", () => {
    expectsAlias("thermal camera", "thermal imaging camera");
    expectsAlias("thermal camera", "thermal imager");
    expectsAlias("thermal camera", "infrared camera");
    expectsAlias("infrared camera", "thermal camera");
    expectsAlias("thermal imager", "thermal imaging camera");
  });

  it("links the night vision group", () => {
    expectsAlias("night vision", "night vision device");
    expectsAlias("night vision device", "nvg");
    expectsAlias("nvg", "night vision goggle");
  });

  it("links the weapon optics group", () => {
    expectsAlias("weapon sight", "reflex sight");
    expectsAlias("reflex sight", "red dot sight");
    expectsAlias("red dot sight", "holographic sight");
  });

  it("links laser range finder and LRF", () => {
    expectsAlias("laser range finder", "lrf");
    expectsAlias("lrf", "laser range finder");
  });

  it("links the camera / surveillance group", () => {
    expectsAlias("ptz camera", "pan tilt zoom camera");
    expectsAlias("optical camera", "surveillance camera");
    expectsAlias("surveillance camera", "optical camera");
  });

  it("expands abbreviations before alias lookup", () => {
    expect(expandAliases(normalizeQuery("ptz").canonical)).toContain("pan tilt zoom");
    expect(expandAliases(normalizeQuery("eoss").canonical)).toContain("electro optical surveillance system");
  });

  it("still matches when the alias is embedded in a longer phrase", () => {
    expect(expandAliases(normalizeQuery("handheld thermal imager for border post").canonical)).toContain("thermal camera");
  });

  it("returns nothing for unrelated text", () => {
    expect(expandAliases(normalizeQuery("office chair").canonical)).toEqual([]);
  });

  it("does not link across unrelated groups", () => {
    expect(expandAliases(normalizeQuery("red dot sight").canonical)).not.toContain("pan tilt zoom camera");
  });
});

describe("normalizePhrase", () => {
  it("normalises a stored field the same way as a query", () => {
    expect(normalizePhrase("Thermal Cameras")).toBe(normalizeQuery("thermal camera").canonical);
  });
});

describe("normalizeKeywordSelection", () => {
  it("keeps each chip as its own query so they can be OR-ed", () => {
    const selection = normalizeKeywordSelection(["Thermal Camera", "Night Vision Device", "Laser Range Finder"]);
    expect(selection).toHaveLength(3);
    expect(selection.map((entry) => entry.canonical)).toEqual([
      "thermal camera",
      "night vision device",
      "laser range finder",
    ]);
  });

  it("deduplicates repeated chips", () => {
    expect(normalizeKeywordSelection(["LWIR", "LWIR"])).toHaveLength(1);
  });

  it("drops blank chips", () => {
    expect(normalizeKeywordSelection(["", "   ", "PTZ Camera"])).toHaveLength(1);
  });

  it("expands each chip's aliases independently", () => {
    const [thermal, nightVision] = normalizeKeywordSelection(["Thermal Camera", "Night Vision Device"]);
    expect(thermal.phrases).toContain("infrared camera");
    expect(nightVision.phrases).toContain("nvg");
    // Groups stay separate - a thermal chip must not pull in night vision.
    expect(thermal.phrases).not.toContain("nvg");
  });
});

describe("buildTsQuery", () => {
  it("ANDs the typed tokens with prefix matching", () => {
    const ts = buildTsQuery(normalizeQuery("thermal camera"));
    expect(ts).toContain("thermal:* & camera:*");
  });

  it("ORs alias phrases in as adjacent-word phrases", () => {
    const ts = buildTsQuery(normalizeQuery("thermal camera"));
    expect(ts).toContain("infrared <-> camera");
    expect(ts.split("|").length).toBeGreaterThan(2);
  });

  it("never lets user input reach tsquery as an operator", () => {
    const ts = buildTsQuery(normalizeQuery("thermal!! & camera|| (x)"));
    // Grouping parentheses and the operators we generate are expected; what
    // must not appear is a negation or a stray operator from the input itself.
    expect(ts).not.toContain("!");
    // Every token position holds bare alphanumerics only.
    for (const token of ts.match(/[a-z0-9:*]+/g) ?? []) {
      expect(token).toMatch(/^[a-z0-9]+:?\*?$/);
    }
  });

  it("returns an empty string for a query with nothing searchable", () => {
    expect(buildTsQuery(normalizeQuery("of the and"))).toBe("");
  });
});

describe("trigramTokens", () => {
  it("returns the significant word tokens", () => {
    expect(trigramTokens(normalizeQuery("thermal camera"))).toEqual(["thermal", "camera"]);
  });

  it("returns nothing for a bid number, which is matched exactly", () => {
    expect(trigramTokens(normalizeQuery("GEM/2026/B/7755763"))).toEqual([]);
  });

  it("drops pure-digit tokens", () => {
    expect(trigramTokens(normalizeQuery("camera 1080"))).toEqual(["camera"]);
  });
});
