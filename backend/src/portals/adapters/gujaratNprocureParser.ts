import * as cheerio from "cheerio";
import { PortalTender } from "../portal.types";

/**
 * Gujarat's real eProcurement domain is tender.nprocure.com (the registry
 * previously pointed at www.nprocure.com, a different/unreachable host --
 * see docs/PORTAL_FEASIBILITY.md, 27 Jul 2026 update). Its public "Tender
 * Closing Calendar" widget (`/dashboard/getTenderClosingData`) embeds a
 * `tenderCounts` JSON map of date -> count for the current month, and each
 * date's count is clickable, POSTing `requestedDate` to
 * `/beforeLoginBidSubmissionClosingReport` to render that day's real tender
 * list -- no login required for either step.
 *
 * That per-day report groups tenders under an "Organisation-Department-
 * SubOffice" heading row, then lists Tender ID / IFB-Notice-Number / Closing
 * Date per tender -- but it does NOT include a descriptive title anywhere;
 * that's simply not part of what this public, no-login report exposes (the
 * full tender detail view requires a bidder login). Rather than fabricate a
 * title, this uses the IFB/Notice reference number as both tenderId and
 * title, same as any other portal where that reference number is the only
 * human-readable label available.
 */

export function extractTenderCounts(html: string): Record<string, number> {
  const match = html.match(/JSON\.parse\('(\{.*?\})'\)/);
  if (!match) return {};
  try {
    const unescaped = match[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
    const parsed = JSON.parse(unescaped);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, number> = {};
    for (const [date, count] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof count === "number" && count > 0) out[date] = count;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * "30-07-2026 15:00" -- DD-MM-YYYY HH:MM, 24-hour, no AM/PM marker.
 */
export function parseGujaratReportDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, dayStr, monthStr, yearStr, hourStr, minStr] = match;
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const year = parseInt(yearStr, 10);
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr, 10);
  const date = new Date(Date.UTC(year, month, day, hour, minute));
  return isNaN(date.getTime()) ? null : date;
}

function splitOrgChain(raw: string): { organisation?: string; department?: string } {
  const parts = raw
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { organisation: parts[0] };
  return { organisation: parts[0], department: parts.slice(1).join(" - ") };
}

export function parseClosingReport(html: string, portalKey: string): PortalTender[] {
  const $ = cheerio.load(html);
  const results: PortalTender[] = [];
  const seen = new Set<string>();
  let currentChain: { organisation?: string; department?: string } = {};

  $("table#mytable tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");

    // Heading row: one <td colspan="4" class="...table_heading_row">Org-Dept-Office</td>
    if (cells.length === 1 && $(tr).find("td.table_heading_row").length > 0) {
      currentChain = splitOrgChain($(cells[0]).text().trim());
      return;
    }

    // Data row: Sr.No / Tender ID / IFB-Notice-Number / Closing date+time
    if (cells.length < 4) return;
    const internalId = $(cells[1]).text().trim();
    const referenceNo = $(cells[2]).text().trim();
    const closingDate = parseGujaratReportDate($(cells[3]).text());

    const tenderId = referenceNo || internalId;
    if (!tenderId || seen.has(tenderId)) return;
    seen.add(tenderId);

    results.push({
      portal: portalKey,
      tenderId,
      title: referenceNo || `Tender ${internalId}`,
      organisation: currentChain.organisation,
      department: currentChain.department,
      state: "Gujarat",
      category: "Government eProcurement",
      closingDate: closingDate?.toISOString(),
      tenderURL: "https://tender.nprocure.com/",
      status: "active",
    });
  });

  return results;
}
