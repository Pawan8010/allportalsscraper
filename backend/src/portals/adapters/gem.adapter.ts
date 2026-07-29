import axios from "axios";
import pLimit from "p-limit";
import { PortalAdapter, PortalAvailability, PortalTender, ScrapeOptions } from "../portal.types";
import { mapGemBidPage } from "./gemApiParser";
import { withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";

/**
 * GeM (Government e-Marketplace) adapter.
 *
 * gem.gov.in itself is an Angular SPA shell, but its bid listing at
 * bidplus.gem.gov.in/all-bids is backed by a plain JSON endpoint,
 * /all-bids-data, the page's own client-side script POSTs to on load and on
 * every pagination click -- gated by a short-lived CSRF token embedded in
 * the listing page's HTML, not a login. Calling that endpoint directly
 * (confirmed live: it returns real Solr-style bid documents, numFound in
 * the tens of thousands) avoids driving a full headless browser entirely --
 * no Playwright, no per-page render cost, and pages can be fetched with
 * real concurrency instead of one browser click at a time.
 */

const GEM_HOME = "https://gem.gov.in/";
const LISTING_URL = "https://bidplus.gem.gov.in/all-bids";
const DATA_URL = "https://bidplus.gem.gov.in/all-bids-data";
const PAGE_SIZE = 10;
const USER_AGENT = "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0; +https://example.invalid/bot)";

async function isJsShellOnly(): Promise<boolean> {
  try {
    const res = await axios.get(GEM_HOME, { timeout: env.portalTimeoutMs, validateStatus: () => true });
    const body: string = res.data ?? "";
    const textLength = body.replace(/<[^>]+>/g, "").trim().length;
    return textLength < 200;
  } catch {
    return true;
  }
}

function cookiesFromSetCookie(setCookie: string[] | undefined): string {
  if (!setCookie) return "";
  return setCookie.map((c) => c.split(";")[0].trim()).join("; ");
}

interface GemSession {
  csrf: string;
  cookie: string;
}

async function fetchSession(): Promise<GemSession> {
  const res = await axios.get(LISTING_URL, {
    timeout: env.portalTimeoutMs,
    validateStatus: (s) => s < 500,
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
  });
  if (res.status >= 400) {
    throw Object.assign(new Error(`HTTP ${res.status} on GeM all-bids page`), { status: res.status });
  }
  const html: string = res.data ?? "";
  const match = html.match(/csrf_bd_gem_nk['"]?\s*[:=]\s*['"]([^'"]+)/);
  if (!match) throw new Error("Unable to read GeM CSRF token from all-bids page");
  return { csrf: match[1], cookie: cookiesFromSetCookie(res.headers["set-cookie"] as string[] | undefined) };
}

function buildPayload(page: number) {
  const data: Record<string, unknown> = {
    param: { searchBid: "", searchType: "fullText" },
    filter: {
      bidStatusType: "ongoing_bids",
      byType: "all",
      highBidValue: "",
      byEndDate: { from: "", to: "" },
      sort: "Bid-End-Date-Oldest",
    },
  };
  if (page > 1) data.page = page;
  return data;
}

interface GemPageResult {
  numFound: number;
  docs: unknown[];
}

async function fetchPage(session: GemSession, page: number): Promise<GemPageResult> {
  const body = new URLSearchParams({
    payload: JSON.stringify(buildPayload(page)),
    csrf_bd_gem_nk: session.csrf,
  });

  return withRetry(
    async () => {
      const res = await axios.post(DATA_URL, body.toString(), {
        timeout: env.portalTimeoutMs,
        validateStatus: (s) => s < 500,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: "https://bidplus.gem.gov.in",
          Referer: LISTING_URL,
          "X-Requested-With": "XMLHttpRequest",
          Cookie: session.cookie,
        },
      });

      // A page/filter combination with no matches answers 404 with a "No
      // data found" body -- that is an empty result, not a failure.
      if (res.status === 404 && /no data found/i.test(String(res.data))) {
        return { numFound: 0, docs: [] };
      }
      if (res.status >= 400) {
        throw Object.assign(new Error(`HTTP ${res.status} from GeM data page ${page}`), { status: res.status });
      }
      const json = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
      if (json.code === 404) return { numFound: 0, docs: [] };
      if (json.code !== 200) throw new Error(`GeM rejected page ${page}: ${json.message ?? "unknown error"}`);
      return { numFound: Number(json.response.response.numFound || 0), docs: json.response.response.docs ?? [] };
    },
    {
      retries: env.portalMaxRetries,
      baseDelayMs: 1000,
      onRetry: (attempt, err) => logger.warn({ portal: "gem", page, attempt, err: String(err) }, "gem API retry"),
    }
  );
}

export const gemAdapter: PortalAdapter = {
  key: "gem",
  name: "Government e-Marketplace",
  baseUrl: "https://gem.gov.in",
  supportsFullScrape: true,
  supportsIncrementalScrape: true,

  async checkAvailability(): Promise<PortalAvailability> {
    const jsOnly = await isJsShellOnly();
    if (!jsOnly) return { available: true };
    try {
      await fetchSession();
      return { available: true };
    } catch (err) {
      return {
        available: false,
        reason: "unreachable",
        detail: `gem.gov.in is a JS-rendered shell and the bidplus.gem.gov.in API session could not be established: ${String(err)}`,
      };
    }
  },

  async scrapeAll(options: ScrapeOptions): Promise<PortalTender[]> {
    const availability = await this.checkAvailability();
    if (!availability.available) {
      logger.warn({ portal: "gem", availability }, "GeM scrape skipped: portal unavailable");
      return [];
    }

    const session = await fetchSession();
    const first = await fetchPage(session, 1);
    const maxAvailablePages = Math.max(1, Math.ceil(first.numFound / PAGE_SIZE));
    // "Full" means full: GeM alone reports 48,000+ live bids (4,800+ pages),
    // but a default cap here silently meant "Scrape All" never actually
    // reached more than the newest ~500 -- confirmed live 29 Jul 2026 (a
    // "successful" full sweep repeatedly re-fetched the same 50 pages,
    // 0 new inserts every time). Matches how every GePNIC-family adapter
    // already behaves (unbounded by default, options.maxPages only used to
    // deliberately narrow a run). The existing gemApiRequestDelayMs/
    // gemApiConcurrency throttling is what keeps this respectful of GeM's
    // public API, not an artificial page ceiling that defeats the point of
    // a full sweep. scrapeNew() below still passes maxPages: 1 explicitly
    // for the fast hourly incremental check.
    const maxPages = Math.min(options.maxPages ?? maxAvailablePages, maxAvailablePages);

    const all: PortalTender[] = mapGemBidPage(first.docs);
    options.onProgress?.({ pagesScanned: 1, tendersFound: all.length, statedTotal: first.numFound });

    if (maxPages > 1) {
      const limit = pLimit(Math.max(1, env.gemApiConcurrency));
      let pagesScanned = 1;
      // Pages complete out of order under concurrency, so progress tracks a
      // running total via this counter rather than all.length -- all itself
      // is only appended to after every page settles, so reading its length
      // mid-sweep would under-report for the whole run.
      let tendersFound = all.length;
      const remaining = Array.from({ length: maxPages - 1 }, (_, i) => i + 2);

      const pageResults = await Promise.all(
        remaining.map((page) =>
          limit(async () => {
            if (options.signal?.aborted) return [];
            if (env.gemApiRequestDelayMs > 0) {
              await new Promise((r) => setTimeout(r, env.gemApiRequestDelayMs));
            }
            try {
              const result = await fetchPage(session, page);
              pagesScanned += 1;
              const mapped = mapGemBidPage(result.docs);
              tendersFound += mapped.length;
              options.onProgress?.({ pagesScanned, tendersFound });
              return mapped;
            } catch (err) {
              logger.error({ portal: "gem", page, err: String(err) }, "gem page failed, skipping");
              return [];
            }
          })
        )
      );

      for (const pageTenders of pageResults) all.push(...pageTenders);
    }

    const seen = new Set<string>();
    const deduped = all.filter((t) => (seen.has(t.tenderId) ? false : (seen.add(t.tenderId), true)));
    logger.info({ portal: "gem", count: deduped.length, statedTotal: first.numFound }, "gem scrape complete");
    return deduped;
  },

  async scrapeNew(options: ScrapeOptions): Promise<PortalTender[]> {
    // GeM's default sort is "Bid End Date: Oldest First" -- page 1 already
    // surfaces the bids closing soonest, which doubles as "what's most
    // urgent right now" for an incremental check without walking every page.
    return this.scrapeAll({ ...options, maxPages: 1 });
  },
};
