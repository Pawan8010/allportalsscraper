import { describe, expect, it } from "vitest";
import { TenderStatus } from "@prisma/client";
import { resolveSearch, buildWhereClause } from "../src/services/searchService";

/** Renders the generated SQL fragment plus its bound values for inspection. */
function render(params: Parameters<typeof resolveSearch>[0]) {
  const sql = buildWhereClause(resolveSearch(params));
  return { text: sql.sql, values: sql.values };
}

describe("resolveSearch", () => {
  it("applies sane defaults", () => {
    const search = resolveSearch({});
    expect(search.page).toBe(1);
    expect(search.limit).toBe(20);
    expect(search.sort).toBe("relevance");
    expect(search.status).toBe(TenderStatus.LIVE);
    expect(search.hasSearchTerms).toBe(false);
  });

  it("clamps page and limit to safe ranges", () => {
    expect(resolveSearch({ page: 0 }).page).toBe(1);
    expect(resolveSearch({ page: -5 }).page).toBe(1);
    expect(resolveSearch({ limit: 5000 }).limit).toBe(100);
    expect(resolveSearch({ limit: 0 }).limit).toBe(20);
  });

  it("ignores an unknown sort instead of trusting it", () => {
    expect(resolveSearch({ sort: "drop-tables" as never }).sort).toBe("relevance");
  });

  it("ignores unparseable dates", () => {
    const search = resolveSearch({ fromDate: "not-a-date", toDate: "2026-01-01" });
    expect(search.fromDate).toBeNull();
    expect(search.toDate).toBeInstanceOf(Date);
  });

  it("collects every distinct term for live GeM sync", () => {
    const search = resolveSearch({ q: "thermal camera", keywords: ["LRF", "NVG"] });
    expect(search.liveTerms).toEqual(["thermal camera", "LRF", "NVG"]);
  });

  it("treats a query of only stop words as having no search terms", () => {
    expect(resolveSearch({ q: "   " }).hasSearchTerms).toBe(false);
  });
});

describe("buildWhereClause parameterisation", () => {
  it("binds user input as parameters and never interpolates it", () => {
    const { text, values } = render({ q: "'; DROP TABLE tenders; --" });
    // The SQL text carries only placeholders.
    expect(text.toLowerCase()).not.toContain("drop table");
    expect(text).toContain("?");
    // The input itself survives only as a bound value (normalised to lowercase).
    expect(values.some((value) => typeof value === "string" && value.toLowerCase().includes("drop table"))).toBe(true);
  });

  it("strips LIKE wildcards from user input before it becomes a pattern", () => {
    const { values } = render({ q: "100% cotton_wool" });
    const patterns = values.filter((value): value is string => typeof value === "string" && value.startsWith("%"));
    expect(patterns.length).toBeGreaterThan(0);

    for (const pattern of patterns) {
      // Only the two wrapping wildcards we add ourselves may be unescaped.
      expect(pattern.startsWith("%")).toBe(true);
      expect(pattern.endsWith("%")).toBe(true);
      const body = pattern.slice(1, -1);
      expect(body, `pattern body: ${body}`).not.toMatch(/(?<!\\)[%_]/);
    }
  });

  it("filters to LIVE tenders by default", () => {
    const { text, values } = render({});
    expect(text).toContain('"tenderStatus"');
    expect(values).toContain(TenderStatus.LIVE);
  });

  it("drops the status filter when status=ALL", () => {
    const { text } = render({ status: "ALL" });
    expect(text).not.toContain('"tenderStatus"');
  });

  it("matches everything when there are no terms or filters", () => {
    expect(render({ status: "ALL" }).text.trim()).toBe("TRUE");
  });
});

describe("buildWhereClause search semantics", () => {
  it("uses the full-text vector, ILIKE and trigram branches together", () => {
    const { text } = render({ q: "thermal camera" });
    expect(text).toContain("searchVector");
    expect(text).toContain("to_tsquery");
    expect(text).toContain("ILIKE");
    expect(text).toContain("%>");
  });

  it("ANDs the trigram tokens so unrelated rows cannot slip in", () => {
    const { text } = render({ q: "thermal camera" });
    // Both tokens must match the title: `title %> ? AND title %> ?`.
    // OR-ing them here is what would let "Thermal Cycler" through.
    expect(text).toMatch(/t\."title" %> \?\s*AND\s*t\."title" %> \?/);
  });

  it("does not use a trigram branch for a bid number", () => {
    const { text } = render({ q: "GEM/2026/B/7755763" });
    expect(text).toContain('"tenderId" ILIKE');
    expect(text).not.toContain("%>");
  });

  it("ORs multiple keyword chips into a single group", () => {
    const one = render({ keywords: ["Thermal Camera"] });
    const three = render({ keywords: ["Thermal Camera", "Night Vision Device", "Laser Range Finder"] });

    // Each chip contributes its own tsquery alternative...
    const countTsQueries = (text: string) => (text.match(/to_tsquery/g) ?? []).length;
    expect(countTsQueries(one.text)).toBe(1);
    expect(countTsQueries(three.text)).toBe(3);

    // ...and more chips widens the match rather than narrowing it.
    expect(three.text.split(" OR ").length).toBeGreaterThan(one.text.split(" OR ").length);
  });

  it("ANDs typed text against the chip group when both are given", () => {
    const chipsOnly = render({ keywords: ["Thermal Camera"] });
    const both = render({ q: "drone", keywords: ["Thermal Camera"] });

    // The typed text becomes a second tsquery in its own AND-ed group.
    expect((both.text.match(/to_tsquery/g) ?? []).length).toBe(
      (chipsOnly.text.match(/to_tsquery/g) ?? []).length + 1
    );
    expect(both.values).toContain("%drone%");
  });

  it("caps alias pattern expansion so one keystroke cannot fan out unbounded", () => {
    const { values } = render({ q: "thermal camera" });
    const patterns = values.filter((value): value is string => typeof value === "string" && value.startsWith("%"));
    // 4 trigram-indexed columns x at most 24 patterns.
    expect(patterns.length).toBeLessThanOrEqual(4 * 24);
  });

  it("matches short acronym aliases on word boundaries, not as substrings", () => {
    // Regression: the alias "swir" was substring-matched, so ILIKE '%swir%' hit
    // "RELAY SWIRCH PRESSURE HORN" (a misspelling of SWITCH) and dragged a
    // starter-relay tender into the results for "thermal camera".
    const { text, values } = render({ q: "thermal camera" });
    expect(values).not.toContain("%swir%");
    expect(values.some((value) => typeof value === "string" && value.includes("\\mswir"))).toBe(true);
    expect(text).toContain("~*");
  });

  it("still substring-matches ordinary words so inflected forms are found", () => {
    // "sight" must keep matching "Sights" in a stored title.
    const { values } = render({ q: "weapon sight" });
    expect(values).toContain("%weapon sight%");
    expect(values).not.toContain("\\msights?\\M");
  });

  it("allows a pluralised acronym to match", () => {
    const { values } = render({ q: "nvd" });
    expect(values.some((value) => typeof value === "string" && value.includes("s?\\M"))).toBe(true);
  });

  it("escapes regex metacharacters in word-boundary patterns", () => {
    const { values } = render({ q: "a.b*" });
    for (const value of values) {
      if (typeof value === "string" && value.startsWith("\\m")) {
        expect(value).not.toMatch(/(?<!\\)[.*+?^${}()|[\]]/);
      }
    }
  });

  it("adds each structured filter as its own AND condition", () => {
    const bare = render({});
    const filtered = render({ state: "Delhi", department: "Ministry of Defence", category: "GeM Bid" });
    expect(filtered.text.split(" AND ").length).toBeGreaterThan(bare.text.split(" AND ").length);
    expect(filtered.values).toContain("Delhi");
  });

  it("applies date bounds against publishedDate with a createdAt fallback", () => {
    const { text } = render({ fromDate: "2026-01-01", toDate: "2026-12-31" });
    expect(text).toContain('COALESCE(t."publishedDate", t."createdAt")');
  });
});
