import axios from "axios";
import { PortalAdapter, PortalAvailability, PortalTender, ScrapeOptions } from "../portal.types";
import { mapKpppTenderList } from "./kpppParser";
import { withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";

/**
 * See kpppParser.ts for how this endpoint was found (reading the SPA's own
 * compiled bundle) and confirmed live. One dedicated search endpoint per
 * category -- there is no single "all categories" call.
 */
const API_BASE = "https://kppp.karnataka.gov.in/supplier-registration-service/v1/api/portal-service";
const CATEGORIES: { category: string; path: string }[] = [
  { category: "GOODS", path: "search-eproc-tenders" },
  { category: "WORKS", path: "works/search-eproc-tenders" },
  { category: "SERVICES", path: "services/search-eproc-tenders" },
];
const PAGE_SIZE = 100;

async function fetchPage(
  path: string,
  category: string,
  page: number
): Promise<{ tenders: unknown[]; totalCount: number }> {
  const res = await axios.post(
    `${API_BASE}/${path}`,
    { category, status: "PUBLISHED" },
    {
      params: { page, size: PAGE_SIZE, "order-by-tender-publish": true },
      timeout: env.portalTimeoutMs,
      validateStatus: (s) => s < 500,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0)",
        "Content-Type": "application/json",
      },
    }
  );
  if (res.status >= 400) {
    throw Object.assign(new Error(`HTTP ${res.status} on ${path} (${category})`), { status: res.status });
  }
  const totalCount = Number(res.headers["x-total-count"] ?? 0);
  const tenders = Array.isArray(res.data) ? res.data : [];
  return { tenders, totalCount };
}

export const kpppAdapter: PortalAdapter = {
  key: "karnataka",
  name: "Karnataka eProcurement",
  baseUrl: "https://kppp.karnataka.gov.in",
  supportsFullScrape: true,
  supportsIncrementalScrape: true,

  async checkAvailability(): Promise<PortalAvailability> {
    try {
      const { totalCount } = await fetchPage("search-eproc-tenders", "GOODS", 0);
      if (totalCount <= 0) {
        return { available: false, reason: "blocked", detail: "search-eproc-tenders reported zero live tenders" };
      }
      return { available: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      return { available: false, reason: status ? "blocked" : "unreachable", detail: String(err) };
    }
  },

  async scrapeAll(options: ScrapeOptions): Promise<PortalTender[]> {
    const results: PortalTender[] = [];
    let pagesScanned = 0;
    let statedTotal = 0;

    for (const { category, path } of CATEGORIES) {
      if (options.signal?.aborted) break;
      let page = 0;
      let totalCount = Infinity;

      while (page * PAGE_SIZE < totalCount) {
        if (options.signal?.aborted) break;
        const result = await withRetry(() => fetchPage(path, category, page), { retries: env.portalMaxRetries });
        totalCount = result.totalCount;
        statedTotal += page === 0 ? totalCount : 0;
        results.push(...mapKpppTenderList(result.tenders));
        pagesScanned += 1;
        options.onProgress?.({ pagesScanned, tendersFound: results.length, statedTotal });
        page += 1;
        if (result.tenders.length === 0) break; // safety net against an infinite loop on a bad totalCount
        if (env.portalRequestDelayMs > 0) {
          await new Promise((r) => setTimeout(r, env.portalRequestDelayMs));
        }
      }
    }

    logger.info({ portal: "karnataka", pages: pagesScanned, count: results.length }, "karnataka scrape complete");
    return results;
  },

  async scrapeNew(options: ScrapeOptions): Promise<PortalTender[]> {
    return this.scrapeAll(options);
  },
};
