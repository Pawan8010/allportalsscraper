# 23-Portal Government Tender Scraper

A single reusable scraping framework (one adapter interface, one registry,
one orchestrator) covering GeM plus 22 additional Indian government
procurement portals, built on Next.js + Express/TypeScript + Prisma +
PostgreSQL.

**Read `docs/ENVIRONMENT_LIMITATIONS.md` first.** This project was built in
a sandboxed environment with no general internet access (npm registry and
all `.gov.in`/`.nic.in` domains were blocked by the sandbox's network
allowlist), so dependencies were never installed and no live scrape has been
run yet. The code is complete and internally consistent; the steps below are
what turns it into a running, verified system on your machine.

## What's here

```
backend/     Express + TypeScript API, Prisma schema, portal adapters, orchestrator
frontend/    Next.js UI (dark navy/cyan theme), portal filters, scrape controls
docs/        Feasibility log, environment limitations, this README's companion notes
```

## Fastest path to seeing it run: Docker Compose

```bash
docker compose up --build
# then open http://localhost:3000
bash scripts/smoke-test.sh   # optional: verifies health, portals, a scrape, and search all work end to end
```

This runs Postgres, the backend, and the frontend together with one command
and applies the Prisma migration automatically on backend startup. It must
be run on a machine with normal internet access (to pull the Docker base
images and run `npm install`) — this sandbox has neither, which is why it
couldn't be started here (see `docs/ENVIRONMENT_LIMITATIONS.md`).

## Manual setup (without Docker)

### 1. Database

```bash
createdb tender_platform     # or use an existing PostgreSQL instance
cp backend/.env.example backend/.env
# edit backend/.env and set a real DATABASE_URL
```

### 2. Backend

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
npm run lint
npm test
npm run dev        # starts on http://127.0.0.1:4000
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run build
npm run dev        # starts on http://localhost:3000
```

### 4. Verify

- `GET http://127.0.0.1:4000/health` → `{"status":"ok", ...}`
- `GET http://127.0.0.1:4000/api/portals` → 22 portals listed, each with an
  enabled/disabled flag consistent with `docs/PORTAL_FEASIBILITY.md`
- `POST http://127.0.0.1:4000/api/scrape/portal/cppp` with
  `{"mode":"incremental"}` → a `ScrapeRun` row, and (if the live site's
  markup matches what the parser expects) real `Tender` rows
- Open `http://localhost:3000` → search, portal filter, portal status panel,
  scrape buttons all render using data from the API above

## Which portals are enabled by default, and why

See `docs/PORTAL_FEASIBILITY.md` for the full table. Short version: 19 of 22
registered portals (GeM plus 18 NIC GePNIC-based sites) default to enabled;
IREPS, Coal India e-Procurement, and Gujarat's nProcure default to disabled
because a live reachability check on 25 Jul 2026 found they render via
JavaScript/session state that a plain HTTP scraper can't see. Flip
`PORTAL_<KEY>_ENABLED=true` in `backend/.env` once you've manually confirmed
what's publicly viewable on that portal.

## Design docs

The architecture this was built from — adapter interface, registry design,
DB schema, orchestrator, search ranking, and the phased delivery plan — is
in the `23-Portal-Scraper-Architecture-Plan.docx` and the two diagrams
shared earlier in this conversation.
