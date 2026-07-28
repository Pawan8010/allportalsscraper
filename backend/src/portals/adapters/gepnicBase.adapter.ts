import axios, { AxiosInstance } from "axios";
import pLimit from "p-limit";
import {
  PortalAdapter,
  PortalAvailability,
  PortalTender,
  ScrapeOptions,
} from "../portal.types";
import { withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";
import { parseListingPage, detectBlockingPage } from "./gepnicParser";
import { parseOrganisationLinks, parseOrgTenderRows } from "./gepnicOrgParser";

/**
 * Shared adapter for every portal built on NIC's GePNIC eProcurement engine.
 *
 * Primary path (comprehensive, CAPTCHA-free): the public "Tenders by
 * Organisation" index lists every organisation with an active tender and its
 * count, and following an organisation's link (same session) returns its
 * real tender list -- see gepnicOrgParser.ts for how this was confirmed
 * live and why it's not a CAPTCHA bypass (the CAPTCHA-gated generic search
 * is simply never used). This is what scrapeAll/scrapeNew both walk now.
 *
 * checkAvailability() still probes the plain home page: it's the cheapest
 * possible reachability check and catches an outright-down portal before
 * spending a request on the organisation index.
 */

export interface GepnicAdapterConfig {
  key: string;
  name: string;
  baseUrl: string; // e.g. "https://eprocure.gov.in/eprocure/app"
  stateOrScope?: string;
}

const ORG_INDEX_PATH = "?page=FrontEndTendersByOrganisation&service=page";

function cookiesFromSetCookie(setCookie: string[] | undefined): string {
  if (!setCookie) return "";
  return setCookie.map((c) => c.split(";")[0].trim()).join("; ");
}

export function makeGepnicAdapter(config: GepnicAdapterConfig): PortalAdapter {
  // No axios `baseURL` here on purpose: axios's own URL joining always
  // inserts a "/" between baseURL and a non-empty relative path (even for a
  // path that's just a query string), and this NIC GePNIC deployment 404s on
  // any request with a trailing slash before the path/query ends (confirmed
  // live: "/eprocure/app/" -> 404, "/eprocure/app" -> 200). Building the
  // full URL manually and requesting it as an absolute URL sidesteps
  // axios's joining behaviour entirely.
  const client: AxiosInstance = axios.create({
    timeout: env.portalTimeoutMs,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0; +https://example.invalid/bot)",
      Accept: "text/html,application/xhtml+xml",
    },
    validateStatus: (status) => status < 500,
  });

  async function fetchHtml(
    suffix: string,
    cookie?: string
  ): Promise<{ html: string; status: number; setCookie?: string[] }> {
    const url = `${config.baseUrl}${suffix}`;
    const res = await withRetry(
      () => client.get(url, cookie ? { headers: { Cookie: cookie } } : undefined),
      {
        retries: env.portalMaxRetries,
        baseDelayMs: 1000,
        onRetry: (attempt, err) =>
          logger.warn({ portal: config.key, attempt, err: String(err) }, "gepnic adapter retry"),
      }
    );
    return { html: res.data as string, status: res.status, setCookie: res.headers["set-cookie"] as string[] | undefined };
  }

  // Fallback for the rare hiccup (or a deployment that genuinely doesn't
  // expose the by-organisation index): the CAPTCHA-free "latest tenders"
  // home-page widget. Narrower coverage, but always better than a hard
  // failure for the whole portal.
  async function scrapeLatestTendersOnly(): Promise<PortalTender[]> {
    const { html, status } = await fetchHtml("");
    if (status >= 400) {
      throw Object.assign(new Error(`HTTP ${status} from ${config.name} home page`), { status });
    }
    return parseListingPage(html, config.key, config.baseUrl, config.stateOrScope);
  }

  async function crawlByOrganisation(options: ScrapeOptions): Promise<PortalTender[]> {
    const index = await fetchHtml(ORG_INDEX_PATH);
    if (index.status >= 400) {
      throw Object.assign(new Error(`HTTP ${index.status} from ${config.name} organisation index`), {
        status: index.status,
      });
    }
    const cookie = cookiesFromSetCookie(index.setCookie);
    let allOrgs = parseOrganisationLinks(index.html, config.baseUrl);

    if (allOrgs.length === 0) {
      // One retry with a fresh request before giving up on the
      // comprehensive path -- seen live to be transient (a clean retry
      // against the same portal found 113 real organisations when the
      // first attempt found none).
      logger.warn({ portal: config.key }, "organisation index came back empty, retrying once");
      const retryIndex = await fetchHtml(ORG_INDEX_PATH);
      allOrgs = parseOrganisationLinks(retryIndex.html, config.baseUrl);
    }

    if (allOrgs.length === 0) {
      logger.warn(
        { portal: config.key },
        "organisation index unavailable after retry, falling back to latest-tenders-only"
      );
      return scrapeLatestTendersOnly();
    }

    const maxOrgs = options.maxPages && options.maxPages > 0 ? Math.min(options.maxPages, allOrgs.length) : allOrgs.length;
    const orgs = allOrgs.slice(0, maxOrgs);
    const statedTotal = orgs.reduce((sum, o) => sum + o.count, 0);

    const all: PortalTender[] = [];
    const seen = new Set<string>();
    let orgsScanned = 0;
    const limit = pLimit(Math.max(1, env.gepnicOrgConcurrency));

    await Promise.all(
      orgs.map((org) =>
        limit(async () => {
          if (options.signal?.aborted) return;
          if (env.portalRequestDelayMs > 0) {
            await new Promise((r) => setTimeout(r, env.portalRequestDelayMs));
          }
          try {
            const res = await withRetry(() => client.get(org.url, { headers: cookie ? { Cookie: cookie } : undefined }), {
              retries: env.portalMaxRetries,
              baseDelayMs: 1000,
              onRetry: (attempt, err) =>
                logger.warn({ portal: config.key, org: org.name, attempt, err: String(err) }, "gepnic org retry"),
            });
            const rows = parseOrgTenderRows(res.data as string, config.key, config.baseUrl, config.stateOrScope);
            for (const row of rows) {
              if (seen.has(row.tenderId)) continue;
              seen.add(row.tenderId);
              all.push(row);
            }
          } catch (err) {
            logger.error({ portal: config.key, org: org.name, err: String(err) }, "gepnic organisation fetch failed, skipping");
          } finally {
            orgsScanned += 1;
            options.onProgress?.({ pagesScanned: orgsScanned, tendersFound: all.length, statedTotal });
          }
        })
      )
    );

    return all;
  }

  const adapter: PortalAdapter = {
    key: config.key,
    name: config.name,
    baseUrl: config.baseUrl,
    supportsFullScrape: true,
    supportsIncrementalScrape: true,

    async checkAvailability(): Promise<PortalAvailability> {
      try {
        const { html, status } = await fetchHtml("");
        if (status >= 400) {
          return { available: false, reason: "blocked", detail: `HTTP ${status} on home page.` };
        }
        const blocked = detectBlockingPage(html);
        if (blocked.blocked) {
          return {
            available: false,
            reason: blocked.reason as "captcha" | "login-required",
            detail:
              blocked.reason === "captcha"
                ? "Response contains a CAPTCHA challenge."
                : "Response indicates an authenticated session is required.",
          };
        }
        return { available: true };
      } catch (err) {
        return { available: false, reason: "unreachable", detail: String(err) };
      }
    },

    async scrapeAll(options: ScrapeOptions): Promise<PortalTender[]> {
      return crawlByOrganisation(options);
    },

    async scrapeNew(options: ScrapeOptions): Promise<PortalTender[]> {
      // The organisation crawl is the only comprehensive, CAPTCHA-free path
      // this platform offers -- there's no separate cheap "what's new"
      // endpoint, so incremental runs walk the same crawl. Upserts are
      // content-hashed, so tenders that haven't changed are skipped rather
      // than rewritten, keeping repeat runs cheap on the database even
      // though every run still requests every organisation.
      return crawlByOrganisation(options);
    },
  };

  return adapter;
}
