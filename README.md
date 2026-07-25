# All Portals Tender Scraper

A full-stack Indian government tender aggregation and search platform. It collects public tenders from GeM and
supported central/state procurement portals, deduplicates them in PostgreSQL, and serves one searchable Next.js
dashboard.

```text
Public procurement portals
      |
   Portal adapters (automatic and assisted)
      |
   Parse, normalize, validate
      |
   PostgreSQL + Prisma upsert (unique portal + tender number)
      |
   Express API
      |
   Next.js frontend
      |
   Search results and tender cards
```

## Features

- Scrapes active public tenders from GeM and supported GePNIC-based central/state portals, following pagination until
  each portal reports no more results. Portal totals are read from source pages and are never hard-coded.
- Tracks stored count, source-reported count, run status and last scrape time separately for every configured portal.
- Supports assisted browser sessions for portals that require a user to solve CAPTCHA manually; CAPTCHA is never
  bypassed.
- Deduplicates by `(portal, tenderId)`, so re-scraping updates a record while identical numbers from different portals
  remain separate.
- Full scrape and incremental scrape are both **resumable** - a run killed mid-sweep is marked `INTERRUPTED` and the next
  run of the same mode continues from its last stored page and re-queues any failed pages. Once a run completes, the next
  one starts a fresh sweep from page 1; `POST /api/scrape/all?resume=false` forces that explicitly.
- Stale bids are marked `CLOSED`, never deleted, and only after a full sweep that completed with zero page failures.
- One normalized search pipeline over PostgreSQL full-text search + trigram matching, with alias/abbreviation expansion
  and typo tolerance.
- Automatic incremental refresh every six hours; scrapes run in the background and never block the API.
- Opens the original GeM bid/document link from each card.

## Tech Stack

- Frontend: Next.js 14 (App Router), React 18, TypeScript - port 3000
- Backend: Node.js, Express, TypeScript - port 4000
- Database: PostgreSQL 14+ (needs the `pg_trgm` and `unaccent` extensions)
- ORM: Prisma
- Scraper transport: GeM's public bid endpoint plus public GePNIC organisation listings, with cookie sessions and retries
- Tests: Vitest + Supertest

## External requirements

| Requirement | Why | If unavailable |
| --- | --- | --- |
| PostgreSQL reachable at `DATABASE_URL` | Everything is served from it | API refuses to start; `GET /health/db` returns 503 |
| `pg_trgm`, `unaccent` extensions | Trigram typo tolerance and full-text search | Created by `prisma migrate deploy`; needs a role allowed to `CREATE EXTENSION` |
| GeM portal reachable | Scraping and live search sync | Search still works from stored data; scrape runs finish `FAILED`/`PARTIAL` and say why |
| Outbound HTTPS to `bidplus.gem.gov.in` | Scraping and live search sync | Search still works from stored data |

Only public tender listing pages are read - the same `/all-bids` listing and `/all-bids-data` JSON endpoint a browser
uses, both permitted by `https://bidplus.gem.gov.in/robots.txt`. No login, CAPTCHA or access control is bypassed. Keep
scraper concurrency low and request delays non-zero: this is a public government service.

## Local development

### Prerequisites

- Node.js 20+ (uses the built-in `fetch`)
- PostgreSQL 14+

### Fastest setup with Docker

```bash
git clone https://github.com/Pawan8010/allportalsscraper.git
cd allportalsscraper
docker compose up --build
```

Open <http://localhost:3000>. PostgreSQL data persists in the `rrp_pg_data` Docker volume. Stop the services with
`docker compose down`; add `-v` only when you intentionally want to delete all stored tenders.

### 1. Create the database

This project uses its **own** database, separate from anything else on the host. As a superuser:

```sql
CREATE ROLE rrp_user LOGIN PASSWORD 'choose-a-password';
CREATE DATABASE rrp_tender_db OWNER rrp_user;
\c rrp_tender_db
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
GRANT ALL ON SCHEMA public TO rrp_user;
```

Then point `DATABASE_URL` in `backend/.env` at it:

```text
DATABASE_URL=postgresql://rrp_user:choose-a-password@localhost:5432/rrp_tender_db?schema=public
```

Creating the two extensions needs a superuser or a role with `CREATE` on the database; the migrations also attempt them
with `IF NOT EXISTS`.

### 2. Backend

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Copy `backend/.env.example` to `backend/.env` first and set `DATABASE_URL`. Every variable is validated at startup, so a
missing or malformed value fails immediately with a message naming the variable.

> **If `npx prisma generate` reports "the URL must start with the protocol `postgresql://`"** while `backend/.env` looks
> correct, a `DATABASE_URL` set in your shell or Windows user environment is shadowing the file - the Prisma CLI prefers
> the real environment over `.env`. Either unset that variable, or use the bundled scripts, which force `.env` to win:
>
> ```bash
> npm run prisma:generate
> npm run prisma:deploy
> ```

### 3. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Copy `frontend/.env.example` to `frontend/.env` if you need a non-default API URL.

Open <http://localhost:3000>. The backend is at <http://127.0.0.1:4000>.

### Production build

```bash
cd backend  && npm run build && npm start
cd frontend && npm run build && npm start
```

### Tests and checks

```bash
cd backend
npm run typecheck   # tsc over src/ and tests/
npm test            # Vitest: unit + integration
```

The integration tests run against the database in `backend/.env` and never contact GeM (`LIVE_SEARCH_ENABLED` is forced
off). They create fixtures prefixed `TEST-VITEST/` and `TEST-UPSERT/` and delete them afterwards. If PostgreSQL is
unreachable they log `[skipped - PostgreSQL unreachable]` rather than passing silently.

## Using the dashboard

### Scrape All Portals

Starts full sweeps for all automatic portal adapters and upserts each tender by `(portal, tenderId)`. The dashboard
reports progress and counts per portal. Assisted portals expose an **Open / Resume CAPTCHA** action and import public
results only after the user completes the portal's own challenge.

### Scrape New Tenders From All

Walks the newest pages for every automatic portal. Existing records are updated in place and new records are inserted,
so repeated runs do not create duplicates.

### Search

Type in the search box - results update as you type (350 ms debounce). Search is case-insensitive and normalizes
Unicode, whitespace, punctuation, hyphens, plurals and common misspellings before matching.

Matching covers bid number, title, organisation, department, description, category, state and location, and expands
related terms - so `thermal camera` also finds `thermal imaging camera`, `thermal imager` and `infrared camera`, and
`nvg` finds `night vision goggle`.

AND/OR behaviour:

- **Multiple keyword chips** return tenders matching **any** selected chip (OR).
- **Text in the search box** must match, across all searchable fields.
- Using both at once means: matches the typed text **and** at least one selected chip.

`No results found` appears only when the API really returned zero rows. There is no broad fallback, so unrelated tenders
are never padded in.

## API

Base URL: `http://127.0.0.1:4000`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | `{ "status": "ok" }` |
| `GET` | `/health/db` | Confirms PostgreSQL answers |
| `GET` | `/api/tenders/stats` | `totalTenders`, `gemListedTotal`, `newToday`, `closingSoon`, `keywordMatches`, `lastScrapeAt` |
| `GET` | `/api/tenders/search` | The search pipeline (see parameters below) |
| `GET` | `/api/tenders` | Same pipeline with no search terms |
| `GET` | `/api/tenders/:id` | Full detail, by uuid or GeM bid number |
| `POST` | `/api/scrape/all` | Start a full sweep; returns `runId` + initial progress. `?resume=false` ignores the previous watermark and sweeps from page 1 |
| `POST` | `/api/scrape/new` | Start an incremental scrape; returns `runId` |
| `GET` | `/api/scrape/status/:runId` | `status`, `pagesScanned`, `tendersFound`, `inserted`, `updated`, `skipped`, `errors`, `failedPages`, `gemStatedTotal`, `startedAt`, `finishedAt` |
| `GET` | `/api/scrape/status` | Whether a scrape is running, plus the latest run |

### `GET /api/tenders/search`

Query parameters: `q`, `keywords` (repeatable or comma-separated), `page`, `limit` (max 100), `sort`, `status`,
`fromDate`, `toDate`, plus `state`, `department`, `organisation` and `category`.

`sort` is one of `relevance` (default), `newest`, `oldest`, `closing_soon`, `highest_value`, `lowest_value`,
`recently_updated`. `status` is a `TenderStatus` or `ALL`; the default is `LIVE`.

Responds with `data`, `total`, `pagination`, `source`, `searchedAt` and `meta`. `meta` carries the normalized query, the
alias phrases it expanded to, the internal `topScore`, and GeM's own stated total under `meta.live` when a live snapshot
exists.

```bash
curl "http://127.0.0.1:4000/api/tenders/search?q=thermal+camera&limit=5"
curl "http://127.0.0.1:4000/api/tenders/search?keywords=Thermal+Camera&keywords=Night+Vision+Device&limit=5"
curl "http://127.0.0.1:4000/api/tenders/search?q=GEM/2026/B/7455778"
curl -X POST "http://127.0.0.1:4000/api/scrape/new"
curl -X POST "http://127.0.0.1:4000/api/scrape/all?resume=false"
```

## How search accuracy is achieved

1. Input is trimmed, Unicode-normalized (diacritics, smart quotes, dash and space variants), lowercased, stripped of
   harmless punctuation, whitespace-collapsed, spell-corrected and singularised.
2. Abbreviations expand (`ptz` -> `pan tilt zoom`, `lrf` -> `laser range finder`) and alias groups pull in related
   phrasings.
3. Matching combines three indexed strategies: the `searchVector` tsquery (prefix-matched tokens AND-ed, alias phrases
   OR-ed in as adjacency phrases), `ILIKE` against the trigram-indexed short columns, and per-token trigram matching on
   the title for typo tolerance.
4. The trigram branch **AND-s** its tokens. That is what keeps precision: `thermal camera` matches a misspelled
   `Tharmal Imaging Camera` but excludes `Thermal Cycler`, which matches `thermal` and not `camera`.
5. Ranking: exact bid number, then bid-number fragment, then exact phrase in title, then alias phrase in title, then
   keyword tag, then organisation/department/category/state/location, then description, then full-text rank, then
   trigram similarity. The score stays internal and is reported under `meta.topScore`.
6. Results are deduplicated by `(portal, tenderId)`, and every sort ends with portal/tender-number tiebreakers so
   pagination is stable.
7. When a live GeM snapshot is fresh, GeM's own ordering is preserved for the bids it returned.

All SQL is parameterized - user input is only ever a bound value.

### Live GeM sync during search

With `LIVE_SEARCH_ENABLED=true`, an unseen or stale search term schedules a **background** sync of GeM's public search
and the request returns immediately from PostgreSQL. Requests never wait on GeM; that is what previously produced
`Failed to fetch` timeouts. Set `LIVE_SEARCH_ENABLED=false` to serve purely from stored data.

## Database

`prisma/schema.prisma` defines `Tender` plus normalized `Buyer`, `Location`, `Financial`, `Eligibility`, `Product`,
`Attachment` and `UpdateHistory` relations, and `ScrapeRun` for progress tracking and resumability.

`Tender` is keyed on `(portal, tenderId)`, which is what makes a re-scrape update a bid instead of duplicating it.
`ScrapeRun` records `mode`, `status`, `pagesScraped`, `tendersFound`, `tendersNew`, `tendersUpdated`, `tendersSkipped`,
`errorCount`, `failedPages`, GeM's `statedTotal`, the `lastPage` watermark used for resuming, and `heartbeatAt`.

Indexes cover `tenderId`, `title`, `organisation`, `department`, `location`, `state`, `category`, `publishedDate`,
`closingDate`, `tenderStatus`, `portal`, `keywordMatched`, `lastSeenAt` and `lastSeenRunId`. A GIN index backs
`searchVector` (maintained by a `BEFORE INSERT OR UPDATE` trigger over title, bid number, organisation, department,
keyword tags, state, category, location and description), and GIN trigram indexes back `title`, `tenderId`,
`organisation`, `department` and `keywordMatched`.

## Docker

```bash
docker compose up --build
```

Creates PostgreSQL, applies migrations, and starts both services. Frontend on 3000, backend on 4000.

For a non-local deployment, set strong `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` values before starting
Compose and restrict database/API ports at the host firewall or reverse proxy.

## Notes for other developers

- Never commit `.env`; use the `.env.example` files.
- `SCRAPER_MAX_PAGES=0` means "scrape every page GeM reports".
- A full sweep is thousands of pages and takes several minutes.
- GeM may rate-limit or transiently reject requests. Failed pages are logged, recorded on the run row, retried with
  exponential backoff, and re-queued by the next run of the same mode. Existing records are never destroyed because a
  page failed.
- Each running scrape writes a `heartbeatAt` on every progress update. Startup only marks a `RUNNING` row `INTERRUPTED`
  when that heartbeat has been quiet for more than two minutes, so starting a second backend against the same database
  cannot flip a healthy in-flight scrape to `INTERRUPTED` (which previously also poisoned the resume watermark).
- Because of that heartbeat, do not run `npm run dev` and `npm start` against the same database at once expecting two
  independent schedulers - the second process will fail to bind port 4000 and exit.
- GeM counts listing rows while this app stores unique bid numbers, so `totalTenders` can differ from `gemListedTotal`.
  The dashboard shows the gap explicitly rather than hiding it.
- `frontend/next.config.mjs` deliberately does **not** set `output: "standalone"` - Next cannot serve a standalone build
  through `next start`. See the comment in that file before re-adding it.
