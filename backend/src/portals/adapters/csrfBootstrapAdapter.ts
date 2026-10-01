import axios from "axios";
import { PortalAdapter, PortalAvailability, PortalTender, ScrapeOptions } from "../portal.types";
import { parseCsrfBootstrapListing, parseCorrigendumJson } from "./csrfBootstrapParser";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";

/**
 * Telangana and Andhra Pradesh migrated off the shared NIC GePNIC platform
 * (confirmed live 27 Jul 2026 -- see docs/PORTAL_FEASIBILITY.md) onto a
 * different, shared-between-the-two vendor platform. Its home page
 * auto-submits a hidden form (`onloadFun()` in the page's inline script) to
 * `login.html`, echoing back a `CSRFToken` value that was itself just
 * handed to us in that same home page's markup -- no real credentials, no
 * CAPTCHA, just a token round-trip, same shape as Bihar's public-listing
 * bearer-token flow in biharAdapter.ts.
 *
 * Both states' dashboards actually render THREE categories in one response
 * (Current/Live Tenders, Corrigendums, and -- Andhra Pradesh only --
 * Upcoming Tenders all share the same markup, e.g. AP's `.samer` blocks),
 * and the parser doesn't scope its selectors to one tab, so all of them get
 * captured in a single pass already. Telangana's Corrigendums tab is the one
 * exception: it's populated by a separate client-side AJAX call rather than
 * being server-rendered, so this adapter fetches that endpoint too (see
 * `corrigendumPath` below).
 *
 * Known scope limit: each category tab is itself a capped preview (~5 items
 * observed) with its own "More..." link. No click handler for it exists in
 * any JS file this session loads (checked every script both platforms
 * reference), no MIS-report page or nav menu offered a broader search, and
 * guessed query parameters on `login.html` had no effect on the response --
 * tried this thoroughly (27 Jul 2026) before concluding the fuller list
 * needs a real registered-supplier login, not something to fabricate. What
 * this adapter returns is real and accurate for its scope, just narrower
 * than "every tender this state has ever published."
 */
function cookiesFromSetCookie(setCookie: string[] | undefined): string {
  if (!setCookie) return "";
  return setCookie.map((c) => c.split(";")[0].trim()).join("; ");
}

async function fetchListingHtml(baseUrl: string): Promise<{ html: string; csrfToken: string; cookie: string }> {
  const homeRes = await axios.get(baseUrl, {
    timeout: env.portalTimeoutMs,
    validateStatus: (s) => s < 500,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0)" },
  });
  if (homeRes.status >= 400) {
    throw Object.assign(new Error(`HTTP ${homeRes.status} on home page`), { status: homeRes.status });
  }
  const homeHtml: string = homeRes.data ?? "";
  const tokenMatch = homeHtml.match(/name=["']CSRFToken["']\s+value=["']([^"']+)["']/i);
  if (!tokenMatch) throw new Error("CSRFToken not found on home page");

  const cookie = cookiesFromSetCookie(homeRes.headers["set-cookie"] as string[] | undefined);

  const params = new URLSearchParams();
  params.set("CSRFToken", tokenMatch[1]);
  params.set("hdnEncryptNames", "hdnEncryptNames");
  params.set("hdnEncryptValues", "hdnEncryptValues");

  const loginRes = await axios.post(`${baseUrl}login.html`, params.toString(), {
    timeout: env.portalTimeoutMs,
    validateStatus: (s) => s < 500,
    maxRedirects: 5,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0)",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: baseUrl,
      Cookie: cookie,
    },
  });
  if (loginRes.status >= 400) {
    throw Object.assign(new Error(`HTTP ${loginRes.status} from login.html`), { status: loginRes.status });
  }
  const html: string = loginRes.data ?? "";
  // The logged-in page hands back its own (still anonymous) CSRFToken,
  // needed for the follow-up corrigendum AJAX call -- reuse the home
  // page's token if this response doesn't carry one for some reason.
  const freshTokenMatch = html.match(/name=["']CSRFToken["']\s+value=["']([^"']+)["']/i);
  return { html, csrfToken: freshTokenMatch?.[1] ?? tokenMatch[1], cookie };
}

async function fetchCorrigendumJson(baseUrl: string, csrfToken: string, cookie: string): Promise<string | null> {
  try {
    const res = await axios.get(`${baseUrl}hPageCorrigendumDetails.html`, {
      params: { CSRFToken: csrfToken },
      timeout: env.portalTimeoutMs,
      validateStatus: (s) => s < 500,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0)",
        Cookie: cookie,
      },
    });
    if (res.status >= 400) return null;
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  } catch {
    // Andhra Pradesh 404s here (its corrigendums are already inline in the
    // main listing) -- treat any failure as "nothing extra to add" rather
    // than failing the whole scrape over an optional bonus source.
    return null;
  }
}

export function makeCsrfBootstrapAdapter(config: {
  key: string;
  name: string;
  baseUrl: string;
  state: string;
  hasCorrigendumEndpoint?: boolean;
}): PortalAdapter {
  // baseUrl must end with a trailing slash: login.html is resolved relative to it.
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;

  return {
    key: config.key,
    name: config.name,
    baseUrl,
    supportsFullScrape: true,
    supportsIncrementalScrape: true,

    async checkAvailability(): Promise<PortalAvailability> {
      try {
        await fetchListingHtml(baseUrl);
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
      const { html, csrfToken, cookie } = await fetchListingHtml(baseUrl);
      const tenders = parseCsrfBootstrapListing(html, config.key, config.state, baseUrl);

      const seen = new Set(tenders.map((t) => t.tenderId));
      if (config.hasCorrigendumEndpoint) {
        const corrigendumJson = await fetchCorrigendumJson(baseUrl, csrfToken, cookie);
        if (corrigendumJson) {
          for (const t of parseCorrigendumJson(corrigendumJson, config.key, config.state, baseUrl)) {
            if (seen.has(t.tenderId)) continue;
            seen.add(t.tenderId);
            tenders.push(t);
          }
        }
      }

      options.onProgress?.({ pagesScanned: 1, tendersFound: tenders.length });
      logger.info({ portal: config.key, count: tenders.length }, `${config.key} scrape complete`);
      return tenders;
    },

    async scrapeNew(options: ScrapeOptions): Promise<PortalTender[]> {
      return this.scrapeAll(options);
    },
  };
}
