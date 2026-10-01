# What was, and wasn't, verified in this build session

Being direct about this because the brief explicitly asked not to claim a
portal works unless it's been tested against the real site.

## The sandbox this code was written in has no general internet access

Every outbound request from the coding sandbox goes through an allowlisted
proxy. During this build, the proxy was confirmed to block:

- `https://registry.npmjs.org` (`403 blocked-by-allowlist`) — so `npm install`
  could not be run in the sandbox for this project's dependencies
  (express, prisma, cheerio, axios, next, playwright, etc. are none of them
  installable here).
- `https://eprocure.gov.in`, and every other `*.gov.in`/`*.nic.in` domain —
  confirmed via `curl -v` returning the same `blocked-by-allowlist` proxy
  error, not a portal-side block.

A *separate* fetch tool available in this environment (used earlier in the
conversation to research the portals) does have outbound access and was used
to read the live pages in text form. That tool converts pages to
readable text, though, not raw HTML — so exact CSS selectors/table ids could
not be captured from it either. That's why `gepnicParser.ts` is written to
be structure-tolerant (scans all tables, identifies rows heuristically)
rather than hard-coded to a specific selector, and is flagged in code
comments as needing confirmation against a real saved page.

## Consequence: what "done" means in this codebase right now

- **Written and internally consistent:** every file in `backend/` and
  `frontend/` — the adapter framework, registry, orchestrator, Prisma
  schema, API routes, search ranking, and the UI.
- **Unit tested with fixtures:** date parsing, tender ID extraction, and the
  GePNIC table-parsing logic all have Jest tests against saved HTML
  fixtures in `backend/tests/fixtures/`. Those fixtures are modeled on the
  real markup pattern observed live, but are hand-built, not a byte-for-byte
  saved copy of a live page.
- **Not run in this session:** `npm install`, `npx prisma migrate`,
  `npm run build`, `npm run lint`, `npm test`, or any live scrape against a
  real portal. The sandbox cannot reach the npm registry or any `.gov.in`
  domain, so none of these could be executed here.
- **Syntax-checked, not type/behavior-checked:** see the verification notes
  in the final summary for exactly what static check was possible without
  installable dependencies.

## What you need to do on your own machine before trusting this in production

1. `cd backend && npm install` (needs normal internet access — this will
   work fine outside this sandbox).
2. Set a real `DATABASE_URL` in `backend/.env` and run
   `npx prisma migrate dev --name init`, then apply
   `prisma/manual_sql/001_search_support.sql` once against the same database.
3. `npm run build && npm run lint && npm test` — this is the first point
   these commands will actually execute.
4. Start the backend (`npm run dev`) and call
   `POST /api/scrape/portal/cppp` with `{"mode":"incremental"}` — this is
   the pilot portal most likely to work first, since its public listing was
   directly confirmed reachable without CAPTCHA/login on 25 Jul 2026.
5. Only after step 4 produces real rows in the `Tender` table should CPPP
   (or any other portal) be described as "working."
