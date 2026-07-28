/**
 * Date parsing for the formats actually observed on NIC GePNIC portals
 * (verified live on eprocure.gov.in and defproc.gov.in, 25 Jul 2026):
 *   "21-Jan-2026 03:00 PM"
 *   "21-Jan-2026" (date only, seen on some corrigendum rows)
 * Falls back to a generic Date.parse for portals with different formats
 * (e.g. ISO 8601), and returns null (never throws, never fabricates a date)
 * when nothing matches, so bad input surfaces as "unknown" rather than a
 * silently wrong date.
 */
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const GEPNIC_DATE_RE =
  /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i;

export function parseGepnicDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(GEPNIC_DATE_RE);
  if (match) {
    const [, dayStr, monStr, yearStr, hourStr, minStr, ampm] = match;
    const month = MONTHS[monStr.toLowerCase()];
    if (month === undefined) return null;
    let hour = hourStr ? parseInt(hourStr, 10) : 0;
    const minute = minStr ? parseInt(minStr, 10) : 0;
    if (ampm) {
      const isPM = ampm.toUpperCase() === "PM";
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
    }
    const day = parseInt(dayStr, 10);
    const year = parseInt(yearStr, 10);
    const date = new Date(Date.UTC(year, month, day, hour, minute));
    return isNaN(date.getTime()) ? null : date;
  }

  // Fallback: ISO-ish or other portal-native formats.
  const generic = new Date(trimmed);
  return isNaN(generic.getTime()) ? null : generic;
}

/**
 * GeM (bidplus.gem.gov.in) renders bid start/end dates as
 * "27-05-2026 6:47 PM" -- DD-MM-YYYY, unlike GePNIC's "21-Jan-2026" month
 * abbreviation format, and JS's generic Date.parse misreads the numeric
 * DD-MM as MM-DD (or rejects it outright), so it needs its own parser.
 */
const GEM_DATE_RE = /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

export function parseGemDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(GEM_DATE_RE);
  if (!match) return null;
  const [, dayStr, monthStr, yearStr, hourStr, minStr, ampm] = match;
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const year = parseInt(yearStr, 10);
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr, 10);
  const isPM = ampm.toUpperCase() === "PM";
  if (isPM && hour !== 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;
  const date = new Date(Date.UTC(year, month, day, hour, minute));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Extracts a reference/tender number from free text where the ID appears as
 * a distinct token (e.g. a table cell already isolated to just the ID) or is
 * embedded in a longer string like "Reference No: ABC/123/2026".
 *
 * Found via an actual run against captured GePNIC page content (not just
 * unit test fixtures): real reference numbers routinely contain spaces and
 * parentheses -- e.g. "NO./ITBP/TELE/G.SHOP/FRESH RATION/25-26" and
 * "DC(Engr)/SHQ/JPG/2025-26/15", both taken verbatim from eprocure.gov.in
 * and defproc.gov.in listings fetched live on 25 Jul 2026. An earlier
 * version of this function restricted the bare-token fallback to
 * `[A-Za-z0-9/_.-]` only, which silently rejected both of those real IDs
 * (no match -> tender dropped entirely, with no error). Caught by running
 * gepnicParser.ts against a table-row fixture built from that same real
 * content: 2 of 3 rows were dropped. Fixed by trusting any non-empty,
 * non-whitespace-only cell text as the reference number once the labelled
 * pattern doesn't match -- callers only invoke this on cells already known
 * not to be the title and not to be a date, so "some other text in this
 * position" reliably means "this is the reference number".
 */
export function extractTenderId(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const labelled = cleaned.match(/(?:reference|tender)\s*(?:no\.?|number|id)\s*[:-]?\s*([A-Za-z0-9/_.-]+)/i);
  if (labelled) return labelled[1];
  return cleaned;
}
