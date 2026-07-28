import { TenderStatus } from "@prisma/client";

/** Parses currency-ish strings like "₹ 12,50,000.00" or "Rs. 45000" into a number. */
export function parseCurrency(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses dates in common GeM formats (DD-MM-YYYY, DD/MM/YYYY, with optional
 * time like "12-08-2026 15:00 PM"). Falls back to native Date parsing.
 */
export function parseGemDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const dmyMatch = trimmed.match(
    /(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?/i
  );
  if (dmyMatch) {
    const [, dd, mm, yyyy, hh, min, meridian] = dmyMatch;
    let hours = hh ? parseInt(hh, 10) : 0;
    if (meridian?.toUpperCase() === "PM" && hours < 12) hours += 12;
    if (meridian?.toUpperCase() === "AM" && hours === 12) hours = 0;
    const date = new Date(
      parseInt(yyyy, 10),
      parseInt(mm, 10) - 1,
      parseInt(dd, 10),
      hours,
      min ? parseInt(min, 10) : 0
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Maps free-text status labels from GeM to our TenderStatus enum. */
export function parseStatus(text: string | null | undefined): TenderStatus {
  if (!text) return TenderStatus.UNKNOWN;
  const normalized = text.trim().toLowerCase();

  if (normalized.includes("cancel")) return TenderStatus.CANCELLED;
  if (normalized.includes("award")) return TenderStatus.AWARDED;
  if (normalized.includes("close") || normalized.includes("expired")) return TenderStatus.CLOSED;
  if (normalized.includes("live") || normalized.includes("open") || normalized.includes("active"))
    return TenderStatus.LIVE;

  return TenderStatus.UNKNOWN;
}

/** Resolves a possibly-relative URL against the GeM base URL. */
export function resolveUrl(base: string, maybeRelative: string | null | undefined): string | null {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

/** Trims and collapses whitespace; returns null for empty strings. */
export function cleanText(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length ? cleaned : null;
}
