import { parseGepnicDate, extractTenderId } from "../../src/utils/dateParser";

describe("parseGepnicDate", () => {
  it("parses date+time with PM correctly", () => {
    const d = parseGepnicDate("21-Jan-2026 03:00 PM");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(0); // January
    expect(d!.getUTCDate()).toBe(21);
    expect(d!.getUTCHours()).toBe(15);
  });

  it("parses date+time with AM correctly, including 12 AM edge case", () => {
    const d = parseGepnicDate("05-Feb-2026 12:00 AM");
    expect(d!.getUTCHours()).toBe(0);
  });

  it("handles 12 PM (noon) correctly", () => {
    const d = parseGepnicDate("05-Feb-2026 12:00 PM");
    expect(d!.getUTCHours()).toBe(12);
  });

  it("parses date-only strings", () => {
    const d = parseGepnicDate("19-Jan-2026");
    expect(d).not.toBeNull();
    expect(d!.getUTCDate()).toBe(19);
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(parseGepnicDate("not a date")).toBeNull();
    expect(parseGepnicDate("")).toBeNull();
    expect(parseGepnicDate(undefined)).toBeNull();
    expect(parseGepnicDate(null)).toBeNull();
  });
});

describe("extractTenderId", () => {
  it("extracts a labelled reference number", () => {
    expect(extractTenderId("Reference No: IIPE/SnP/2025-26/09")).toBe("IIPE/SnP/2025-26/09");
  });

  it("accepts a bare reference token with slashes and dashes", () => {
    expect(extractTenderId("DCEngr/SHQ/JPG/2025-26/15")).toBe("DCEngr/SHQ/JPG/2025-26/15");
  });

  it("accepts a plain alphanumeric reference token", () => {
    expect(extractTenderId("8532/E8")).toBe("8532/E8");
  });

  it("returns null for whitespace-only or empty text", () => {
    expect(extractTenderId("   ")).toBeNull();
    expect(extractTenderId("")).toBeNull();
  });
});
