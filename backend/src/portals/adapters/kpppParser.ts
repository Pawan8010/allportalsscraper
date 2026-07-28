import { PortalTender } from "../portal.types";

/**
 * Karnataka migrated its live tender data to a new Angular SPA,
 * kppp.karnataka.gov.in (the old eproc.karnataka.gov.in portal is confirmed
 * dead -- see docs/PORTAL_FEASIBILITY.md, 27 Jul 2026). That SPA calls a
 * public (no-login) JSON REST API to render its own tender list:
 *   POST https://kppp.karnataka.gov.in/supplier-registration-service/v1/api/portal-service/search-eproc-tenders
 *   POST .../portal-service/works/search-eproc-tenders
 *   POST .../portal-service/services/search-eproc-tenders
 * (one dedicated endpoint per category -- GOODS/WORKS/SERVICES respectively,
 * found by reading the SPA's own compiled main.js for its API base URL and
 * the `search-eproc-tenders` path, then confirmed live by replaying the
 * exact request body its own tenderSearch() method sends: {category,
 * status:"PUBLISHED"} as the POST body, `page`/`size`/`order-by-tender-publish`
 * as query params, with the real result count in an `x-total-count`
 * response header). This is real, complete JSON -- title, description,
 * department, dates -- no HTML scraping needed at all.
 */

export interface KpppTender {
  id: number;
  tenderNumber?: string | null;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  categoryText?: string | null;
  deptId?: number | null;
  deptName?: string | null;
  status?: string | null;
  publishedDate?: string | null;
  tenderClosureDate?: string | null;
  locationId?: number | null;
  locationName?: string | null;
  workCategoryName?: string | null;
}

/**
 * "27-07-2026 18:28:18" -- DD-MM-YYYY HH:MM:SS, 24-hour, with seconds.
 */
export function parseKpppDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, dayStr, monthStr, yearStr, hourStr, minStr, secStr] = match;
  const date = new Date(
    Date.UTC(
      parseInt(yearStr, 10),
      parseInt(monthStr, 10) - 1,
      parseInt(dayStr, 10),
      parseInt(hourStr, 10),
      parseInt(minStr, 10),
      parseInt(secStr, 10)
    )
  );
  return isNaN(date.getTime()) ? null : date;
}

export function mapKpppTender(t: KpppTender): PortalTender | null {
  const tenderId = (t.tenderNumber ?? "").trim() || (t.id ? String(t.id) : "");
  const title = (t.title ?? "").replace(/\s+/g, " ").trim();
  if (!tenderId || !title) return null;

  return {
    portal: "karnataka",
    tenderId,
    title,
    department: t.deptName ?? undefined,
    state: "Karnataka",
    category: t.categoryText ?? t.category ?? "Government eProcurement",
    description: (t.description ?? "").replace(/\s+/g, " ").trim() || undefined,
    publishedDate: parseKpppDate(t.publishedDate)?.toISOString(),
    closingDate: parseKpppDate(t.tenderClosureDate)?.toISOString(),
    tenderURL: "https://kppp.karnataka.gov.in/",
    status: "active",
  };
}

export function mapKpppTenderList(rows: unknown): PortalTender[] {
  if (!Array.isArray(rows)) return [];
  return (rows as KpppTender[]).map(mapKpppTender).filter((t): t is PortalTender => t !== null);
}
