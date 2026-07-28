import * as cheerio from "cheerio";
import { config } from "../config/env";
import { RawScrapedTender } from "../types/scraper";
import { withRetry } from "../utils/retry";
import { CurlSession } from "./curlSession";
import { PortalDefinition } from "./portalRegistry";

interface OrganisationLink {
  name: string;
  count: number;
  url: string;
}

export interface GepnicScrapeOptions {
  maxOrganisations?: number;
  onBatch?: (tenders: RawScrapedTender[], organisationIndex: number, statedTotal: number) => Promise<void>;
  onOrganisationError?: (organisationIndex: number, organisation: string, error: Error) => void;
  onTotalKnown?: (statedTotal: number, organisations: number) => void;
}

export interface GepnicScrapeResult {
  tenders: RawScrapedTender[];
  organisationsScraped: number;
  statedTotal: number;
  failedOrganisations: number[];
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absoluteUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

function organisationLinks(html: string, portal: PortalDefinition): OrganisationLink[] {
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
        links.push({ name, count, url: absoluteUrl(portal.baseUrl, href) });
      });
  });

  return links;
}

function bracketValues(value: string): string[] {
  return Array.from(value.matchAll(/\[([^\]]*)\]/g), (match) => clean(match[1])).filter(Boolean);
}

export function parseGepnicTenderRows(html: string, portal: PortalDefinition): RawScrapedTender[] {
  const $ = cheerio.load(html);
  const rows: RawScrapedTender[] = [];

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

        rows.push({
          portal: portal.shortName,
          tenderId,
          title,
          organisation: organisationChain[0] ?? portal.name,
          department: organisationChain[1] ?? null,
          location: portal.state ?? "India",
          state: portal.state ?? null,
          category: "Government eProcurement",
          description: [title, referenceNumber, ...organisationChain].filter(Boolean).join(" | "),
          publishedDateText: clean(cells.eq(1).text()),
          closingDateText: clean(cells.eq(2).text()),
          openingDateText: clean(cells.eq(3).text()),
          tenderURL: detailHref ? absoluteUrl(portal.baseUrl, detailHref) : portal.baseUrl,
          documentURL: null,
          statusText: "LIVE",
        });
      });
  });

  return rows;
}

/**
 * Crawls every organisation-specific active-tender list exposed by GePNIC.
 *
 * The generic "Active Tenders" form is CAPTCHA protected. The public
 * organisation index and its active lists expose the same active records
 * without submitting that form, so this crawler never automates or bypasses a
 * CAPTCHA.
 */
export async function scrapeGepnicPortal(
  portal: PortalDefinition,
  options: GepnicScrapeOptions = {}
): Promise<GepnicScrapeResult> {
  if (portal.family !== "GEPNIC") {
    throw new Error(`${portal.name} is not configured as a GePNIC portal`);
  }

  const session = await CurlSession.create(`gepnic-${portal.key}`);
  try {
    const indexUrl = `${portal.baseUrl}?page=FrontEndTendersByOrganisation&service=page`;
    const indexHtml = await withRetry(() => session.get(indexUrl), {
      retries: config.scraperMaxRetries,
      baseDelayMs: Math.max(250, config.scraperRequestDelayMs),
      label: `${portal.key} organisation index`,
    });
    const allOrganisations = organisationLinks(indexHtml, portal);
    if (allOrganisations.length === 0) {
      throw new Error(`${portal.name} returned no organisation tender links`);
    }

    const configuredLimit = options.maxOrganisations ?? 0;
    const organisations =
      configuredLimit > 0 ? allOrganisations.slice(0, configuredLimit) : allOrganisations;
    const statedTotal = organisations.reduce((total, organisation) => total + organisation.count, 0);
    options.onTotalKnown?.(statedTotal, organisations.length);

    const tenders: RawScrapedTender[] = [];
    const failedOrganisations: number[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < organisations.length; index += 1) {
      const organisation = organisations[index];
      try {
        const html = await withRetry(() => session.get(organisation.url), {
          retries: config.scraperMaxRetries,
          baseDelayMs: Math.max(250, config.scraperRequestDelayMs),
          label: `${portal.key} ${organisation.name}`,
        });
        const parsed = parseGepnicTenderRows(html, portal).filter((tender) => {
          if (seen.has(tender.tenderId)) return false;
          seen.add(tender.tenderId);
          return true;
        });
        tenders.push(...parsed);
        await options.onBatch?.(parsed, index + 1, statedTotal);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        failedOrganisations.push(index + 1);
        options.onOrganisationError?.(index + 1, organisation.name, normalized);
      }

      if (config.scraperRequestDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.scraperRequestDelayMs));
      }
    }

    return {
      tenders,
      organisationsScraped: organisations.length - failedOrganisations.length,
      statedTotal,
      failedOrganisations,
    };
  } finally {
    await session.dispose();
  }
}
