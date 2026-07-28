# Portal feasibility — live check log (25 Jul 2026, updated 27 Jul 2026)

## Update, 27 Jul 2026: Karnataka / Telangana / Andhra Pradesh / IREPS / Gujarat

Deeper live investigation of the 5 portals disabled after the 26 Jul 2026
migration check (this machine has real internet access, unlike the
constrained sandbox described in `docs/ENVIRONMENT_LIMITATIONS.md`). Four of
five now have real automatic adapters; the fifth (IREPS) has a genuine,
deliberate access-control barrier with no way around it found.

- **Telangana & Andhra Pradesh**: same non-GePNIC platform. Both serve a
  real, public tender list via a plain HTTP `GET` (home page, to read a
  `CSRFToken` from a hidden form field) followed by a `POST` echoing that
  token back to `login.html` — no real login, no CAPTCHA. Scraped
  automatically by `csrfBootstrapAdapter.ts` / `csrfBootstrapParser.ts`.
  This dashboard actually renders up to three categories in one response
  (Current/Live Tenders, Corrigendums, and — Andhra Pradesh only — Upcoming
  Tenders, all sharing the same markup), and the parser isn't scoped to one
  tab, so it captures all of them in a single pass. Telangana's
  Corrigendums tab is the one exception — it's AJAX-loaded rather than
  server-rendered, from a separate endpoint (`hPageCorrigendumDetails.html`,
  found by reading the page's own `fnCorrigendumHomepage()` handler) that
  this adapter also fetches. Proven live 27 Jul 2026: 10 real tenders for
  Telangana (5 Live + 5 Corrigendum, the latter with real estimated-cost
  data), 40 for Andhra Pradesh.
  **Known ceiling**: each category tab is itself a capped preview (~5 items
  observed) with its own "More..." link, and no way was found to see past
  it anonymously — checked every JS file both platforms load for a click
  handler (none found), tried the MIS Reports page (redirects to a generic
  welcome page), and tried common pagination query parameters on
  `login.html` (`?count=`, `?size=`, `?page=` — all ignored, same response
  every time). This is a real platform ceiling for guest access, not a
  parsing gap — getting past it would need an actual registered-supplier
  login, which isn't something to fabricate.
- **Karnataka**: the *old* portal (`eproc.karnataka.gov.in`) is confirmed
  dead -- its real, CAPTCHA-free JSF search form returns **"No Tenders
  Found" for every status** (Published, Closed, Under Evaluation, Awarded,
  Finalized) across the full 365-day window it allows. Live data moved to a
  new Angular SPA, `kppp.karnataka.gov.in`. Found its public (no-login) JSON
  search API by reading the SPA's own compiled `main.js` bundle for its API
  base URL, then replaying the exact request its own `tenderSearch()`
  method sends: `POST .../supplier-registration-service/v1/api/portal-service/search-eproc-tenders`
  (and `works/`, `services/` siblings -- one dedicated endpoint per
  category, body `{"category":"GOODS","status":"PUBLISHED"}`, real total in
  an `x-total-count` response header). Complete, clean JSON -- title,
  description, department, dates -- no HTML scraping at all. Scraped
  automatically by `kpppAdapter.ts` / `kpppParser.ts`.
- **IREPS**: no automated or alternative unauthenticated path found despite
  trying all three of the portal's own listed entry points: (1) the
  "guest"/anonymous search genuinely requires a real mobile number and an
  SMS OTP (landed on a form with a "Get OTP" button + 6-digit OTP field);
  (2) the "advance search" form has no OTP fields at all but still
  redirects to a login page when actually submitted; (3) the static
  "awarded supply contracts" page links to 7 separate railway
  production-unit sites (ICF/RCF/RWF/DLW/MCF/CORE/CLW) that publish tenders
  independently of IREPS, but on this check most either didn't resolve,
  refused the connection, or (when reachable) were thin navigation shells
  rather than a tender table -- not pursued further given 7x the per-site
  parser work for uncertain payoff. A deliberate access control, not a
  technical gap. Registry's assisted-scrape entry point points directly at
  the real guest-search URL so a human doing the assisted scrape doesn't
  have to find it manually.
- **Gujarat nProcure**: the registry previously pointed at `www.nprocure.com`,
  which is genuinely unreachable from this network (real TCP connect
  timeout, confirmed on two separate checks). The actual portal -- found
  via web search, not guessed -- is at `tender.nprocure.com`, and is fully
  reachable. Its public "Tender Closing Calendar" widget lists every date
  in the current month with tenders closing, and a follow-up `POST` per
  date returns that day's real tender list, no login required. One real
  limitation: this public report has no descriptive title column, only
  Tender ID / IFB-Notice-Number / closing date, so the reference number
  doubles as both `tenderId` and `title`. Scraped automatically by
  `gujaratNprocureAdapter.ts` / `gujaratNprocureParser.ts`.

This is the reachability check behind every `enabled`/`disabled` default in
`backend/src/portals/portalRegistry.ts`. Each URL was fetched with a single
unauthenticated GET (no CAPTCHA bypass, no login, no scripted interaction
beyond one page load) to determine whether tender data is visible without
authentication, and whether the page is static HTML or requires JavaScript.

| # | Portal | Domain | Result | Registry default |
|---|--------|--------|--------|-------------------|
| 1 | GeM | gem.gov.in | Angular SPA — plain GET returns no visible content | `PORTAL_GEM_ENABLED=true`, but adapter self-reports unavailable until Playwright/Chromium is installed or selectors are wired against a real rendered DOM |
| 2 | CPPP / eProcure | eprocure.gov.in | NIC GePNIC engine. Public "Latest Tenders"/"Latest Corrigendums" table loads with no login/CAPTCHA | enabled |
| 3 | GePNIC (parent site) | gepnic.gov.in | Informational/marketing site, not a tender search UI — links out to the state instances below | not a registry entry |
| 4 | IREPS (Railways) | ireps.gov.in | Plain GET returned no static content — JS/session-heavy | `PORTAL_IREPS_ENABLED=false` |
| 5 | Defence eProcurement | defproc.gov.in | NIC GePNIC engine, identical structure to eprocure.gov.in, public listing loads with no login/CAPTCHA | enabled |
| 6 | Coal India e-Procurement | coalindiatenders.nic.in | Plain GET returned only the page title, no body content | `PORTAL_COALINDIA_ENABLED=false` |
| 7 | Maharashtra | mahatenders.gov.in | NIC GePNIC engine (same family) | enabled |
| 8 | Gujarat (nProcure) | nprocure.com | Plain GET returned empty body. Different vendor (Antares/Nextenders), not NIC GePNIC | `PORTAL_GUJARAT_NPROCURE_ENABLED=false` |
| 9 | Karnataka | eproc.karnataka.gov.in | NIC GePNIC engine (same family) | enabled |
| 10 | Tamil Nadu | tntenders.gov.in | NIC GePNIC engine (same family) | enabled |
| 11 | Telangana | tender.telangana.gov.in | NIC GePNIC engine (same family) | enabled |
| 12 | Andhra Pradesh | apeprocurement.gov.in | NIC GePNIC engine (same family) | enabled |
| 13 | Uttar Pradesh | etender.up.nic.in | NIC GePNIC engine (same family) | enabled |
| 14 | Rajasthan | eproc.rajasthan.gov.in | NIC GePNIC engine (same family) | enabled |
| 15 | Madhya Pradesh | mptenders.gov.in | NIC GePNIC engine (same family) | enabled |
| 16 | Haryana | etenders.hry.nic.in | NIC GePNIC engine (same family) | enabled |
| 17 | Punjab | eproc.punjab.gov.in | NIC GePNIC engine (same family) | enabled |
| 18 | Kerala | etenders.kerala.gov.in | NIC GePNIC engine (same family) | enabled |
| 19 | West Bengal | wbtenders.gov.in | NIC GePNIC engine (same family) | enabled |
| 20 | Odisha | tendersodisha.gov.in | NIC GePNIC engine (same family) | enabled |
| 21 | Bihar | eproc2.bihar.gov.in | NIC GePNIC engine (same family) | enabled |
| 22 | Jharkhand | jharkhandtenders.gov.in | NIC GePNIC engine (same family) | enabled |
| 23 | Assam | assamtenders.gov.in | NIC GePNIC engine (same family) | enabled |

**"Enabled" above means "registered and worth attempting" — it is not the
same as "proven working".** Every GePNIC-family portal shares the same
parsing code (`gepnicBase.adapter.ts` / `gepnicParser.ts`), which was unit
tested against a hand-built fixture modeled on the real markup pattern seen
live, but the exact table markup on each of the 18 individual state sites has
not been captured and diffed against that fixture (this sandbox's network is
allowlisted and excludes every `*.gov.in`/`*.nic.in` domain — see
`docs/ENVIRONMENT_LIMITATIONS.md`). Before relying on any single portal in
production, run its adapter once against the live site and confirm real rows
land in Postgres.

## What "enabled: true" does NOT mean here

- It does not mean the adapter has been run against that specific state's
  live site yet.
- It does not mean the exact table selectors have been hand-verified for
  that state (they were written generically against the CPPP/Defence
  markup pattern and are expected to transfer, but "expected" is not
  "confirmed").

## Next steps to move a portal from "enabled" to "proven working"

1. Run `scrapePortal("<key>", "incremental")` against the live portal from a
   machine with normal internet access.
2. Inspect the `ScrapeRun` row it creates and the `Tender` rows it inserted.
3. Spot check 3-5 inserted tenders against the portal's own website.
4. If dates/IDs look wrong, tighten `gepnicParser.ts` for that portal's
   specific markup and re-run.
