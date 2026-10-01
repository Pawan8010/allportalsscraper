import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { PortalTender } from "../portal.types";
import { parseGepnicDate, extractTenderId } from "../../utils/dateParser";

/**
 * Pure parsing logic for GePNIC-family listing pages, split out from
 * gepnicBase.adapter.ts so it can be unit tested directly against saved
 * HTML fixtures without needing a live network call or an HTTP mock.
 */
export function extractRowsFromTable(
  $: cheerio.CheerioAPI,
  table: Element,
  portalKey: string,
  baseUrl: string,
  stateOrScope?: string
): PortalTender[] {
  const results: PortalTender[] = [];

  $(table)
    .find("tr")
    .each((_, tr) => {
      const cells = $(tr).find("td");
      if (cells.length < 2) return; // header row or spacer row

      // These GePNIC pages are deeply nested legacy table layouts: a row
      // whose cell itself contains another <table> is a layout wrapper
      // around real content elsewhere on the page (often the very listing
      // table this loop will also reach directly), not a leaf tender row.
      // Its .text() would otherwise swallow every nested row's text into
      // one giant blob. Skip it rather than mis-parse it.
      const hasNestedTable = cells.toArray().some((td) => $(td).find("table").length > 0);
      if (hasNestedTable) return;

      const link = $(tr).find("a[href]").first();
      const title = link.text().trim();
      const href = link.attr("href")?.trim();
      if (!title || !href) return;

      const cellTexts = cells.toArray().map((td) => $(td).text().trim());
      let referenceNo: string | null = null;
      const dateHits: Date[] = [];

      for (const text of cellTexts) {
        if (text === title) continue;
        const parsedDate = parseGepnicDate(text);
        if (parsedDate) {
          dateHits.push(parsedDate);
          continue;
        }
        if (!referenceNo) {
          const maybeId = extractTenderId(text);
          if (maybeId) referenceNo = maybeId;
        }
      }

      // Real tender rows always carry at least a closing date; nav/footer
      // links that happen to have >=2 cells and a link (e.g. "More...",
      // the NIC credit line) never do. Requiring one avoids storing those
      // as fake tenders with no way to say when they close.
      if (!referenceNo || dateHits.length === 0) return;

      const tenderURL = href.startsWith("http") ? href : new URL(href, baseUrl + "/").toString();

      results.push({
        portal: portalKey,
        tenderId: referenceNo,
        title,
        state: stateOrScope,
        tenderURL,
        closingDate: dateHits[0]?.toISOString(),
        openingDate: dateHits[1]?.toISOString(),
        status: "active",
      });
    });

  return results;
}

export function parseListingPage(
  html: string,
  portalKey: string,
  baseUrl: string,
  stateOrScope?: string
): PortalTender[] {
  const $ = cheerio.load(html);
  const found: PortalTender[] = [];
  $("table").each((_, table) => {
    found.push(...extractRowsFromTable($, table, portalKey, baseUrl, stateOrScope));
  });

  const seen = new Set<string>();
  return found.filter((t) => {
    if (seen.has(t.tenderId)) return false;
    seen.add(t.tenderId);
    return true;
  });
}

export function detectBlockingPage(html: string): { blocked: boolean; reason?: "captcha" | "login-required" } {
  const lowered = html.toLowerCase();
  if (lowered.includes("captcha")) return { blocked: true, reason: "captcha" };
  if (lowered.includes("please login") || lowered.includes("session expired")) {
    return { blocked: true, reason: "login-required" };
  }
  return { blocked: false };
}
