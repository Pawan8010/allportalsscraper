import axios from "axios";
import { PortalAdapter, PortalAvailability, PortalTender, ScrapeOptions } from "../portal.types";
import { mapBiharTenderList } from "./biharParser";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";

/**
 * Bihar migrated off the shared NIC GePNIC platform onto its own "EPSV2Web"
 * system (confirmed live 26 Jul 2026: eproc2.bihar.gov.in/ redirects to
 * /EPSV2Web/). That new platform serves the public tender list as JSON from
 * its own REST endpoint, gated by a short-lived bearer token embedded as a
 * hidden input on the listing page rather than a login -- no session/CAPTCHA
 * to solve, just: load the public page, read the token, POST it back.
 */

const BASE_URL = "https://eproc2.bihar.gov.in/EPSV2Web";
const LISTING_URL = `${BASE_URL}/openarea/tenderListingPage.action`;
const TENDER_LIST_URL = `${BASE_URL}/rest/openarea/getTenderList`;

function cookiesFromSetCookie(setCookie: string[] | undefined): string {
  if (!setCookie) return "";
  return setCookie.map((c) => c.split(";")[0].trim()).join("; ");
}

async function fetchListingSession(): Promise<{ authorization: string; cookie: string }> {
  const res = await axios.get(LISTING_URL, {
    timeout: env.portalTimeoutMs,
    validateStatus: (s) => s < 500,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0)" },
  });
  if (res.status >= 400) {
    throw Object.assign(new Error(`HTTP ${res.status} on Bihar listing page`), { status: res.status });
  }
  const html: string = res.data ?? "";
  const match = html.match(/id=["']Authorization["'][^>]*value=["']([^"']+)["']/i);
  if (!match) throw new Error("Bihar public tender page did not provide an Authorization token");

  const setCookie = res.headers["set-cookie"] as string[] | undefined;
  return { authorization: match[1], cookie: cookiesFromSetCookie(setCookie) };
}

export const biharAdapter: PortalAdapter = {
  key: "bihar",
  name: "Bihar eProcurement",
  baseUrl: BASE_URL,
  supportsFullScrape: true,
  supportsIncrementalScrape: true,

  async checkAvailability(): Promise<PortalAvailability> {
    try {
      await fetchListingSession();
      return { available: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      return {
        available: false,
        reason: status ? "blocked" : "unreachable",
        detail: String(err),
      };
    }
  },

  async scrapeAll(options: ScrapeOptions): Promise<PortalTender[]> {
    const { authorization, cookie } = await fetchListingSession();
    const res = await axios.post(TENDER_LIST_URL, "{}", {
      timeout: env.portalTimeoutMs,
      validateStatus: (s) => s < 500,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0)",
        Authorization: authorization,
        "Auth-Token": "X-Requested-With",
        "Content-Type": "application/json;charset=utf-8",
        Referer: LISTING_URL,
        Cookie: cookie,
      },
    });
    if (res.status >= 400) {
      throw Object.assign(new Error(`HTTP ${res.status} from Bihar tender list`), { status: res.status });
    }
    const tenders = mapBiharTenderList(res.data);
    // The API returns every open tender in one response, so the raw row
    // count (before filtering out any malformed rows) is the portal's own
    // reported total -- there's no separate "N results" figure to read.
    const statedTotal = Array.isArray(res.data) ? res.data.length : tenders.length;
    options.onProgress?.({ pagesScanned: 1, tendersFound: tenders.length, statedTotal });
    logger.info({ portal: "bihar", count: tenders.length }, "bihar scrape complete");
    return tenders;
  },

  async scrapeNew(options: ScrapeOptions): Promise<PortalTender[]> {
    return this.scrapeAll(options);
  },
};
