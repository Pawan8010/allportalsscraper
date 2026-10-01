import * as cheerio from "cheerio";
import { PortalTender } from "../portal.types";

/**
 * Pure parsing logic for the CSRF-bootstrap platform shared by Telangana
 * and Andhra Pradesh (see csrfBootstrapAdapter.ts for the network/session
 * side). Both states run the same underlying auth mechanism but render
 * their tender listing with different markup, captured live 27 Jul 2026:
 *   - Andhra Pradesh: `.samer` blocks, semantically-classed links
 *     (`.coli-id`, `.coli-tno`, `.tDesc`), closing date as one string with
 *     a year (`.coli-date`, "03/08/2026 05:00 PM").
 *   - Telangana: `.update-nag` blocks, unlabelled links inside `.update-text`
 *     `<p>` tags, closing date split across three `<h4>` elements with NO
 *     year shown anywhere (month name / day / time).
 * This parser tries both structures against whatever HTML it's given --
 * only one will ever match for a given portal's real response, so this is
 * "structure-tolerant" in the same spirit as gepnicParser.ts rather than
 * two copy-pasted near-duplicate functions.
 */

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseTimeOfDay(raw: string): { hour: number; minute: number } {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return { hour: 0, minute: 0 };
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const isPM = match[3].toUpperCase() === "PM";
  if (isPM && hour !== 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;
  return { hour, minute };
}

/**
 * Andhra Pradesh's closing-date string includes a year: "03/08/2026 05:00 PM".
 */
export function parseSlashDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const [, dayStr, monthStr, yearStr] = match;
  const { hour, minute } = parseTimeOfDay(`${match[4]}:${match[5]} ${match[6]}`);
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const year = parseInt(yearStr, 10);
  const date = new Date(Date.UTC(year, month, day, hour, minute));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Telangana's closing date has no year anywhere on the page -- just a month
 * name, a day number, and a time, split across three separate elements.
 * Since a "Bid Closing Date" is always in the future relative to when the
 * page is scraped, infer the year as the soonest occurrence of that
 * month/day from `now` (this year, or next year if that date has already
 * passed -- handles scraping in December for a January closing date).
 */
export function parseSplitClosingDate(
  month: string,
  day: string,
  time: string,
  now: Date = new Date()
): Date | null {
  const monthIndex = MONTHS[month.trim().toLowerCase()];
  const dayNum = parseInt(day, 10);
  if (monthIndex === undefined || isNaN(dayNum)) return null;
  const { hour, minute } = parseTimeOfDay(time);
  const year = now.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, monthIndex, dayNum, hour, minute));
  if (candidate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    candidate = new Date(Date.UTC(year + 1, monthIndex, dayNum, hour, minute));
  }
  return isNaN(candidate.getTime()) ? null : candidate;
}

/**
 * Splits "<title> in Division No:<department>." into its two parts. Both
 * states append this suffix to every tender's description text; when it's
 * absent (unexpected markup variant) the whole string is kept as the title
 * rather than silently dropping text.
 */
function splitTitleAndDepartment(raw: string): { title: string; department?: string } {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.*?)\s+in\s+Division\s*No\s*:\s*(.+?)\.?\s*$/i);
  if (match) return { title: match[1].trim(), department: match[2].trim() };
  return { title: cleaned };
}

export interface CorrigendumRecord {
  nProcurementID?: number | string;
  nTenderID?: number | string;
  sTenderNo?: string;
  sCircle_Division?: string;
  sDepartmentName?: string;
  sNameOfWork?: string;
  dtBidSubmissionClosingDate?: string;
  mEstimatedCost?: string | number;
}

/**
 * Telangana's Corrigendums tab is NOT server-rendered in the login.html
 * response (unlike Andhra Pradesh's, which is) -- it's populated by a
 * client-side AJAX call to a separate endpoint,
 * `hPageCorrigendumDetails.html?CSRFToken=...`, found by reading the page's
 * own `fnCorrigendumHomepage()` handler. Confirmed live 27 Jul 2026: this
 * returns clean JSON with a fuller set of fields than the HTML listing
 * (estimated cost included). Andhra Pradesh does not have this endpoint
 * (404s) -- its corrigendums are already covered by the inline `.samer`
 * blocks in the main response.
 */
export function parseCorrigendumJson(
  raw: string,
  portalKey: string,
  state: string,
  baseUrl: string
): PortalTender[] {
  let records: unknown;
  try {
    records = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(records)) return [];

  const results: PortalTender[] = [];
  const seen = new Set<string>();
  for (const r of records as CorrigendumRecord[]) {
    const tenderId = String(r.sTenderNo ?? "").trim() || (r.nTenderID ? String(r.nTenderID) : "");
    const title = String(r.sNameOfWork ?? "").replace(/\s+/g, " ").trim();
    if (!tenderId || !title || seen.has(tenderId)) continue;
    seen.add(tenderId);

    const estimatedValue = r.mEstimatedCost !== undefined ? Number(r.mEstimatedCost) : undefined;
    results.push({
      portal: portalKey,
      tenderId,
      title,
      department: r.sDepartmentName?.trim() || r.sCircle_Division?.trim() || undefined,
      state,
      category: "Government eProcurement",
      estimatedValue: estimatedValue !== undefined && !isNaN(estimatedValue) && estimatedValue > 0 ? estimatedValue : undefined,
      closingDate: parseSlashDate(r.dtBidSubmissionClosingDate)?.toISOString(),
      tenderURL: baseUrl,
      status: "active",
    });
  }
  return results;
}

export function parseCsrfBootstrapListing(
  html: string,
  portalKey: string,
  state: string,
  baseUrl: string
): PortalTender[] {
  const $ = cheerio.load(html);
  const results: PortalTender[] = [];
  const seen = new Set<string>();

  function addTender(tenderId: string, title: string, department: string | undefined, closingDate: Date | null) {
    if (!tenderId || !title || seen.has(tenderId)) return;
    seen.add(tenderId);
    results.push({
      portal: portalKey,
      tenderId,
      title,
      department,
      state,
      category: "Government eProcurement",
      closingDate: closingDate?.toISOString(),
      // The tender detail view is a client-side `viewtender(id)` JS call,
      // not a navigable URL -- link to the listing itself rather than
      // fabricate a detail URL that was never confirmed to work.
      tenderURL: baseUrl,
      status: "active",
    });
  }

  // Andhra Pradesh: `.samer` blocks.
  $(".samer").each((_, el) => {
    const block = $(el);
    const internalId = block.find("a.coli-id").text().trim();
    const reference = block.find("a.coli-tno").text().trim();
    const { title, department } = splitTitleAndDepartment(block.find("a.tDesc").text());
    const closingDate = parseSlashDate(block.find(".coli-date").text());
    addTender(reference || internalId, title, department, closingDate);
  });

  // Telangana: `.update-nag` blocks.
  $(".update-nag, .updateNag").each((_, el) => {
    const block = $(el);
    const paragraphs = block.find(".update-text p");
    if (paragraphs.length < 3) return;

    const internalId = $(paragraphs[0]).find("a").text().trim();
    const reference = $(paragraphs[1]).find("a").text().trim();
    const { title, department } = splitTitleAndDepartment($(paragraphs[2]).find("a").text());

    const h4s = block.find(".update-split h4");
    const closingDate =
      h4s.length >= 3
        ? parseSplitClosingDate($(h4s[0]).text(), $(h4s[1]).text(), $(h4s[2]).text())
        : null;

    addTender(reference || internalId, title, department, closingDate);
  });

  return results;
}
