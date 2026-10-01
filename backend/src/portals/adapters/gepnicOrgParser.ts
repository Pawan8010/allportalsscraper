import * as cheerio from "cheerio";
import { PortalTender } from "../portal.types";

/**
 * Every NIC GePNIC deployment's generic "Active Tenders" search form is
 * CAPTCHA-gated (confirmed live: paginating or searching it redirects into a
 * CAPTCHA challenge). But the same active tenders are also reachable,
 * CAPTCHA-free, through the public "Tenders by Organisation" index --
 * confirmed live on eprocure.gov.in 26 Jul 2026: the index page renders 240
 * real organisation rows (name + active tender count + link) without
 * submitting any form, and following one of those links (with the same
 * session's cookies) returns that organisation's real tender list, also
 * CAPTCHA-free. This is a comprehensive, legitimate path to "every active
 * tender", not a CAPTCHA bypass -- the CAPTCHA-gated search is simply never
 * used.
 */

export interface OrganisationLink {
  name: string;
  count: number;
  url: string;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absoluteUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

export function parseOrganisationLinks(html: string, baseUrl: string): OrganisationLink[] {
  const $ = cheerio.load(html);
  const links: OrganisationLink[] = [];

  $("table.list_table").each((_tableIndex, table) => {
    const header = clean($(table).find("tr.list_header").text());
    if (!header.includes("Organisation Name") || !header.includes("Tender Count")) return;

    $(table)
      .find("tr")
      .each((_rowIndex, row) => {
        const cells = $(row).find("td");
        if (cells.length < 3) return;
        const anchor = cells.eq(2).find('a[href*="DirectLink"]');
        const href = anchor.attr("href");
        if (!href) return;
        const name = clean(cells.eq(1).text());
        const count = Number(clean(anchor.text()).replace(/[^\d]/g, "")) || 0;
        if (!name || count <= 0) return;
        links.push({ name, count, url: absoluteUrl(baseUrl, href) });
      });
  });

  return links;
}

function bracketValues(value: string): string[] {
  return Array.from(value.matchAll(/\[([^\]]*)\]/g), (match) => clean(match[1])).filter(Boolean);
}

export function parseOrgTenderRows(
  html: string,
  portalKey: string,
  baseUrl: string,
  stateOrScope?: string
): PortalTender[] {
  const $ = cheerio.load(html);
  const rows: PortalTender[] = [];

  $("table.list_table").each((_tableIndex, table) => {
    const header = clean($(table).find("tr.list_header").text());
    if (!header.includes("e-Published Date") || !header.includes("Title and Ref.No./Tender ID")) return;

    $(table)
      .find("tr.even, tr.odd")
      .each((_rowIndex, row) => {
        const cells = $(row).find("td");
        if (cells.length < 6) return;

        const titleCell = cells.eq(4);
        const link = titleCell.find('a[title="View Tender Information"]');
        const detailHref = link.attr("href");
        const title = clean(link.text()).replace(/^\[|\]$/g, "");
        const values = bracketValues(clean(titleCell.text()));
        const tenderId = values.at(-1) ?? "";
        const referenceNumber = values.at(-2) ?? "";
        if (!title || !tenderId) return;

        const organisationChain = clean(cells.eq(5).text())
          .split("||")
          .map(clean)
          .filter(Boolean);

        const publishedDate = parseGepnicOrgDate(clean(cells.eq(1).text()));
        const closingDate = parseGepnicOrgDate(clean(cells.eq(2).text()));
        const openingDate = parseGepnicOrgDate(clean(cells.eq(3).text()));

        rows.push({
          portal: portalKey,
          tenderId,
          title,
          organisation: organisationChain[0],
          department: organisationChain[1],
          state: stateOrScope,
          category: "Government eProcurement",
          description: [title, referenceNumber, ...organisationChain].filter(Boolean).join(" | "),
          publishedDate,
          closingDate,
          openingDate,
          tenderURL: detailHref ? absoluteUrl(baseUrl, detailHref) : baseUrl,
          status: "active",
        });
      });
  });

  return rows;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const DATE_RE = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i;

function parseGepnicOrgDate(raw: string): string | undefined {
  const match = raw.trim().match(DATE_RE);
  if (!match) return undefined;
  const [, dayStr, monStr, yearStr, hourStr, minStr, ampm] = match;
  const month = MONTHS[monStr.toLowerCase()];
  if (month === undefined) return undefined;
  let hour = hourStr ? parseInt(hourStr, 10) : 0;
  const minute = minStr ? parseInt(minStr, 10) : 0;
  if (ampm) {
    const isPM = ampm.toUpperCase() === "PM";
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
  }
  const date = new Date(Date.UTC(parseInt(yearStr, 10), month, parseInt(dayStr, 10), hour, minute));
  return isNaN(date.getTime()) ? undefined : date.toISOString();
}
