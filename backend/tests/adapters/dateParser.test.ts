import { parseGepnicDate, parseSlash24hDate, parseAssistedDate, extractTenderId } from "../../src/utils/dateParser";

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

describe("parseSlash24hDate", () => {
  it("parses DD/MM/YYYY HH:MM with a day above 12 -- the exact case that used to become an Invalid Date", () => {
    // "29/07/2026" is unambiguous as DD/MM/YYYY since no month 29 exists,
    // but JS's native `new Date("29/07/2026 10:30")` reads it as MM/DD/YYYY
    // and silently produces an Invalid Date. Real IREPS row, 28 Jul 2026.
    const d = parseSlash24hDate("29/07/2026 10:30");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(6); // July
    expect(d!.getUTCDate()).toBe(29);
    expect(d!.getUTCHours()).toBe(10);
    expect(d!.getUTCMinutes()).toBe(30);
  });

  it("parses a date with no time component", () => {
    const d = parseSlash24hDate("05/02/2026");
    expect(d).not.toBeNull();
    expect(d!.getUTCHours()).toBe(0);
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(parseSlash24hDate("not a date")).toBeNull();
    expect(parseSlash24hDate("21-Jan-2026 03:00 PM")).toBeNull();
    expect(parseSlash24hDate(null)).toBeNull();
  });
});

describe("parseAssistedDate", () => {
  it("prefers the unambiguous slash/24h reading over a misparse", () => {
    const d = parseAssistedDate("29/07/2026 10:30");
    expect(d!.getUTCDate()).toBe(29);
    expect(d!.getUTCMonth()).toBe(6);
  });

  it("still handles the GeM dash/12h format for other assisted portals", () => {
    const d = parseAssistedDate("27-05-2026 6:47 PM");
    expect(d!.getUTCDate()).toBe(27);
    expect(d!.getUTCHours()).toBe(18);
  });

  it("still handles the GePNIC dash-month-name format", () => {
    const d = parseAssistedDate("21-Jan-2026 03:00 PM");
    expect(d!.getUTCMonth()).toBe(0);
  });

  it("returns null rather than an Invalid Date for unrecognised text", () => {
    expect(parseAssistedDate("TODAY")).toBeNull();
    expect(parseAssistedDate(null)).toBeNull();
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
