import { PortalRegistryEntry } from "./portal.types";
import { makeGepnicAdapter } from "./adapters/gepnicBase.adapter";
import { gemAdapter } from "./adapters/gem.adapter";
import { makeGatedStubAdapter } from "./adapters/gatedStub.adapter";
import { biharAdapter } from "./adapters/biharAdapter";
import { makeCsrfBootstrapAdapter } from "./adapters/csrfBootstrapAdapter";
import { gujaratNprocureAdapter } from "./adapters/gujaratNprocureAdapter";
import { kpppAdapter } from "./adapters/kpppAdapter";
import { env } from "../config/env";

/**
 * Single source of truth for every portal the system knows about.
 * Each entry can be disabled independently via PORTAL_<KEY>_ENABLED in .env
 * without touching this file. See docs/PORTAL_FEASIBILITY.md for the
 * live-reachability findings behind each portal's default enabled state.
 */
export const PORTAL_REGISTRY: PortalRegistryEntry[] = [
  {
    key: "gem",
    name: "Government e-Marketplace",
    baseUrl: "https://gem.gov.in",
    enabled: env.portalEnabled("GEM", true),
    adapter: gemAdapter,
    rateLimit: { requestsPerMinute: 20 },
    concurrency: 1,
    requestDelayMs: 1500,
  },
  {
    key: "cppp",
    name: "Central Public Procurement Portal (eProcure)",
    baseUrl: "https://eprocure.gov.in",
    enabled: env.portalEnabled("CPPP", true),
    adapter: makeGepnicAdapter({
      key: "cppp",
      name: "Central Public Procurement Portal (eProcure)",
      baseUrl: "https://eprocure.gov.in/eprocure/app",
    }),
    rateLimit: { requestsPerMinute: 15 },
    concurrency: 1,
    requestDelayMs: 2000,
    // No supportsAssistedScrape here: the by-organisation crawl (see
    // gepnicBase.adapter.ts) already gets comprehensive, CAPTCHA-free
    // coverage automatically -- the CAPTCHA search path this portal also
    // has is now redundant, so it's not offered in the UI.
  },
  {
    key: "defproc",
    name: "Defence eProcurement Portal",
    baseUrl: "https://defproc.gov.in",
    enabled: env.portalEnabled("DEFPROC", true),
    adapter: makeGepnicAdapter({
      key: "defproc",
      name: "Defence eProcurement Portal",
      baseUrl: "https://defproc.gov.in/nicgep/app",
    }),
    rateLimit: { requestsPerMinute: 15 },
    concurrency: 1,
    requestDelayMs: 2000,
  },

  // --- State GePNIC deployments (same shared adapter, different config) ---
  gepnicState("maharashtra", "Maharashtra eProcurement", "https://mahatenders.gov.in/nicgep/app", "Maharashtra"),
  // Karnataka, Telangana, Andhra Pradesh migrated off the shared GePNIC
  // platform (see docs/PORTAL_FEASIBILITY.md / .env comments). Live-checked
  // again 27 Jul 2026:
  {
    key: "karnataka",
    name: "Karnataka eProcurement",
    // The old portal (eproc.karnataka.gov.in) is confirmed dead for
    // scraping purposes: its own search form works (no CAPTCHA, no login)
    // but returns "No Tenders Found" for every status across the full
    // 365-day window it allows. Live data moved to this new Angular SPA --
    // found its public (no-login) JSON search API by reading the SPA's own
    // compiled bundle for its API base URL and replaying the exact request
    // its own tenderSearch() sends. See kpppAdapter.ts / kpppParser.ts.
    baseUrl: "https://kppp.karnataka.gov.in",
    enabled: env.portalEnabled("KARNATAKA", true),
    adapter: kpppAdapter,
    rateLimit: { requestsPerMinute: 15 },
    concurrency: 1,
    requestDelayMs: 1500,
    // Kept as a manual fallback in case the JSON API ever changes shape.
    supportsAssistedScrape: true,
    assistedStartUrl: "https://kppp.karnataka.gov.in/",
  },
  gepnicState("tamilnadu", "Tamil Nadu eProcurement", "https://tntenders.gov.in/nicgep/app", "Tamil Nadu"),
  {
    key: "telangana",
    name: "Telangana eProcurement",
    baseUrl: "https://tender.telangana.gov.in",
    // Confirmed live 27 Jul 2026: this platform's home page auto-submits a
    // CSRFToken back to itself (no real login) and the resulting page
    // already contains the public tender list -- see csrfBootstrapAdapter.ts.
    // Proven with a real incremental scrape the same day (5 tenders
    // inserted), so this defaults to enabled like the other working portals.
    enabled: env.portalEnabled("TELANGANA", true),
    adapter: makeCsrfBootstrapAdapter({
      key: "telangana",
      name: "Telangana eProcurement",
      baseUrl: "https://tender.telangana.gov.in",
      state: "Telangana",
      // Telangana's Corrigendums tab is AJAX-loaded, not server-rendered
      // like the rest -- confirmed live 27 Jul 2026 this endpoint exists
      // and returns real data. Andhra Pradesh 404s on it (not needed there:
      // its corrigendums are already inline in the main response).
      hasCorrigendumEndpoint: true,
    }),
    rateLimit: { requestsPerMinute: 10 },
    concurrency: 1,
    requestDelayMs: 2000,
    // Kept as a manual fallback in case the CSRF-bootstrap flow ever breaks.
    supportsAssistedScrape: true,
    assistedStartUrl: "https://tender.telangana.gov.in/",
  },
  {
    key: "andhrapradesh",
    name: "Andhra Pradesh eProcurement",
    baseUrl: "https://tender.apeprocurement.gov.in",
    // Same platform/flow as Telangana, confirmed live 27 Jul 2026, proven
    // with a real incremental scrape the same day (15 tenders inserted).
    enabled: env.portalEnabled("ANDHRAPRADESH", true),
    adapter: makeCsrfBootstrapAdapter({
      key: "andhrapradesh",
      name: "Andhra Pradesh eProcurement",
      baseUrl: "https://tender.apeprocurement.gov.in",
      state: "Andhra Pradesh",
    }),
    rateLimit: { requestsPerMinute: 10 },
    concurrency: 1,
    requestDelayMs: 2000,
    supportsAssistedScrape: true,
    assistedStartUrl: "https://tender.apeprocurement.gov.in/",
  },
  gepnicState("uttarpradesh", "Uttar Pradesh eProcurement", "https://etender.up.nic.in/nicgep/app", "Uttar Pradesh"),
  gepnicState("rajasthan", "Rajasthan eProcurement", "https://eproc.rajasthan.gov.in/nicgep/app", "Rajasthan"),
  gepnicState("madhyapradesh", "Madhya Pradesh eProcurement", "https://mptenders.gov.in/nicgep/app", "Madhya Pradesh"),
  gepnicState("haryana", "Haryana eProcurement", "https://etenders.hry.nic.in/nicgep/app", "Haryana"),
  gepnicState("punjab", "Punjab eProcurement", "https://eproc.punjab.gov.in/nicgep/app", "Punjab"),
  gepnicState("kerala", "Kerala eProcurement", "https://etenders.kerala.gov.in/nicgep/app", "Kerala"),
  gepnicState("westbengal", "West Bengal eProcurement", "https://wbtenders.gov.in/nicgep/app", "West Bengal"),
  gepnicState("odisha", "Odisha eProcurement", "https://tendersodisha.gov.in/nicgep/app", "Odisha"),
  gepnicState("jharkhand", "Jharkhand eProcurement", "https://jharkhandtenders.gov.in/nicgep/app", "Jharkhand"),
  gepnicState("assam", "Assam eProcurement", "https://assamtenders.gov.in/nicgep/app", "Assam"),
  {
    key: "bihar",
    name: "Bihar eProcurement",
    baseUrl: "https://eproc2.bihar.gov.in/EPSV2Web",
    enabled: env.portalEnabled("BIHAR", true),
    adapter: biharAdapter,
    rateLimit: { requestsPerMinute: 15 },
    concurrency: 1,
    requestDelayMs: 2000,
  },

  // --- Gated: confirmed JS-rendered / non-GePNIC on live check, needs a manual browser review before enabling ---
  {
    key: "ireps",
    name: "Indian Railways E-Procurement System (IREPS)",
    baseUrl: "https://www.ireps.gov.in",
    enabled: env.portalEnabled("IREPS", false),
    supportsAssistedScrape: true,
    // Re-checked live 27 Jul 2026, twice, looking for ANY unauthenticated
    // path to real tender data -- not just the first one tried:
    //   1. menu.js's anonymSearch() -> POST /epsn/guestLogin.do genuinely
    //      requires a real mobile number + SMS OTP (landed on a
    //      guestLogonForm with a "Get OTP" button and a 6-digit OTP input).
    //   2. menu.js's advSearch() looked more promising -- its form
    //      (anonymAdvanceSearchForm, POST /eps/anonymSearch.do) has NO OTP
    //      fields at all, just a free-text box + date range. But submitting
    //      it (even with a session cookie carried through from the same
    //      request chain) redirects to a "Login IREPS E-Auction" page --
    //      the form renders without auth, but results still require it.
    //   3. The static "awarded supply contracts" page links out to 7
    //      separate Railway production-unit sites (ICF, RCF, RWF, DLW, MCF,
    //      CORE, CLW -- each *.indianrailways.gov.in) that publish their
    //      own tenders independently of IREPS, no OTP. Tried 4 of the 7:
    //      RCF/RWF don't resolve or refuse the connection from this
    //      network; ICF/MCF respond but only over HTTPS with an invalid
    //      cert, and what loads is a thin navigation shell, not a tender
    //      table directly -- would need further per-site exploration (each
    //      likely needs its own bespoke parser, 7x the work of one adapter)
    //      with uncertain data-quality payoff. Not pursued further this
    //      round; worth a fresh look from a different network if this
    //      portal becomes a priority again.
    // Conclusion: no automated or alternative unauthenticated path found
    // despite real effort across all three of IREPS's own listed entry
    // points. Point the assisted session at the real guest-search entry
    // (skipping the marketing home page) so the human doing the assisted
    // scrape lands on the actual mobile+OTP flow immediately -- that
    // remains the only honest option.
    assistedStartUrl: "https://www.ireps.gov.in/epsn/anonymSearch.do?searchParam=showPageClosed&language=en",
    adapter: makeGatedStubAdapter({
      key: "ireps",
      name: "Indian Railways E-Procurement System (IREPS)",
      baseUrl: "https://www.ireps.gov.in",
      reason: "login-required",
      detail:
        "Live check 27 Jul 2026: IREPS's guest/anonymous search requires a real mobile number and an " +
        "SMS OTP to proceed (not a CAPTCHA, not JS-rendering -- an actual phone-verification step); its " +
        "advance-search form has no OTP fields but still redirects to a login page on submission; the " +
        "7 railway production-unit sites (ICF/RCF/RWF/DLW/MCF/CORE/CLW) that separately publish tenders " +
        "were mostly unreachable from this network on this check. Start an assisted session, enter your " +
        "own mobile number, enter the OTP you receive, navigate to the tender list, then import the " +
        "visible pages.",
    }),
    rateLimit: { requestsPerMinute: 10 },
    concurrency: 1,
    requestDelayMs: 3000,
  },
  {
    // Re-checked live 26 Jul 2026 (after the trailing-slash/nested-table
    // fixes to the shared GePNIC adapter): coalindiatenders.nic.in/nicgep/app
    // returns a real page with an "activeTenders" table and no CAPTCHA --
    // the original gated assessment was made against the unfixed adapter's
    // trailing-slash 404. It's the same NIC GePNIC software as every other
    // state portal, so the shared adapter applies directly.
    key: "coalindia",
    name: "Coal India e-Procurement",
    baseUrl: "https://coalindiatenders.nic.in",
    enabled: env.portalEnabled("COALINDIA", true),
    adapter: makeGepnicAdapter({
      key: "coalindia",
      name: "Coal India e-Procurement",
      baseUrl: "https://coalindiatenders.nic.in/nicgep/app",
    }),
    rateLimit: { requestsPerMinute: 15 },
    concurrency: 1,
    requestDelayMs: 2000,
  },
  {
    key: "gujarat_nprocure",
    name: "Gujarat eProcurement (nProcure)",
    // The registry previously pointed at www.nprocure.com, which is
    // genuinely unreachable from this network (real TCP connect timeout,
    // confirmed on two separate live checks). The real, reachable domain --
    // found via web search, not guessed -- is tender.nprocure.com. Confirmed
    // live 27 Jul 2026 with a real scrape: its public "Tender Closing
    // Calendar" widget and per-day closing report need no login at all. See
    // gujaratNprocureAdapter.ts / gujaratNprocureParser.ts.
    baseUrl: "https://tender.nprocure.com",
    enabled: env.portalEnabled("GUJARAT_NPROCURE", true),
    adapter: gujaratNprocureAdapter,
    rateLimit: { requestsPerMinute: 10 },
    concurrency: 1,
    requestDelayMs: 3000,
  },
];

function gepnicState(key: string, name: string, baseUrl: string, state: string): PortalRegistryEntry {
  return {
    key,
    name,
    baseUrl,
    enabled: env.portalEnabled(key, true),
    adapter: makeGepnicAdapter({ key, name, baseUrl, stateOrScope: state }),
    rateLimit: { requestsPerMinute: 15 },
    concurrency: 1,
    requestDelayMs: 2000,
    // No supportsAssistedScrape: the by-organisation crawl already gets
    // comprehensive automatic coverage for every portal built with this
    // helper. Portals that migrated off GePNIC entirely (no automatic path
    // at all) opt back in explicitly where this is called below.
  };
}

export function getPortalEntry(key: string): PortalRegistryEntry | undefined {
  return PORTAL_REGISTRY.find((p) => p.key === key);
}

export function getEnabledPortals(): PortalRegistryEntry[] {
  return PORTAL_REGISTRY.filter((p) => p.enabled);
}
