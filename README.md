# RRP Groups Tender Intelligence

A production-oriented tender aggregation, scraping, search, alerting, and administration platform for Indian government procurement portals.

The application collects publicly available tender listings from 22 configured procurement sources, normalises them into PostgreSQL, prevents duplicate records, ranks cross-portal search results, classifies relevance, sends keyword-matched email digests, and exposes scraper health and administration controls through a responsive Next.js dashboard.

> This project does not bypass CAPTCHA, OTP, authentication, or portal access controls. Automatic adapters use public interfaces. IREPS uses an assisted browser flow because its guest tender search requires a real mobile OTP.

## Features

- **22 portal registry** with independent enable flags, rate limits, adapters, and status reporting.
- **Automatic full and incremental scraping** with scheduled hourly refreshes and daily full sweeps.
- **PostgreSQL persistence** through Prisma with `(portal, tenderId)` uniqueness.
- **Fast cross-portal search** with full-text ranking, aliases, structured tender-reference matching, multiple portal filters, multiple keyword filters, relevance filters, and pagination.
- **Tender lifecycle management** that removes closed tenders and prevents their accidental resurrection.
- **Permanent admin deletion** that creates a database tombstone so manually deleted tenders are never imported again.
- **Email/password authentication** using bcrypt password hashes and secure database-backed sessions.
- **Admin console** for users, active sessions, session revocation, backups, SMTP settings, test messages, and immediate matched-alert delivery.
- **Keyword email alerts** with per-user recipient addresses and permanent per-user tender deduplication.
- **Encrypted SMTP credentials** stored with AES-256-GCM and never returned to the browser.
- **Automatic relevance classification** into Relevant, Parts/Non-defence, and Unclassified.
- **Daily JSON backups** of every database table and a confirmation-protected CLI restore command.
- **Responsive UI** with search, portal status, scrape activity, alerts, and admin views.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript, Lucide React |
| Backend | Node.js, Express, TypeScript, Zod |
| Database | PostgreSQL 16, Prisma ORM |
| Scraping | Axios, Cheerio, Playwright for assisted sessions |
| Scheduling | node-cron |
| Authentication | bcryptjs, SHA-256 session-token hashes, HTTP-only cookies |
| Email | Nodemailer, admin-managed SMTP |
| Logging | Pino |
| Tests | Jest, ts-jest |
| Local orchestration | Docker Compose or native Windows scripts |

## Architecture

```mermaid
flowchart TB
    subgraph CLIENTS["Client Layer"]
        VISITOR["Public Visitor"]
        USER["Authenticated User"]
        ADMIN["Administrator"]
        UI["Next.js 14 Frontend<br/>localhost:3000"]
        VISITOR --> UI
        USER --> UI
        ADMIN --> UI
    end

    subgraph API["Application Layer - Express API localhost:4000"]
        AUTH["Email and Password Authentication<br/>bcrypt + HTTP-only sessions"]
        SEARCH["Ranked Cross-Portal Search<br/>aliases + fuzzy matching + filters"]
        SCRAPE["Scrape Orchestrator<br/>full + incremental + per-portal locks"]
        ALERTS["Matched Tender Alert Service<br/>per-user permanent deduplication"]
        LIFECYCLE["Tender Lifecycle Service<br/>cleanup + permanent tombstones"]
        ADMINAPI["Admin Services<br/>sessions + SMTP + backups"]
        SCHEDULER["node-cron Scheduler<br/>hourly incremental + daily full sweep"]
    end

    UI -->|"REST API + session cookie"| AUTH
    UI -->|"search, filters, pagination"| SEARCH
    UI -->|"scrape controls"| SCRAPE
    UI -->|"alert preferences"| ALERTS
    UI -->|"admin-only operations"| ADMINAPI
    SCHEDULER --> SCRAPE
    SCHEDULER --> LIFECYCLE
    SCHEDULER --> ADMINAPI

    subgraph SOURCES["Government Procurement Sources"]
        GEM["GeM JSON/API Adapter"]
        GEPNIC["GePNIC Organisation Crawlers<br/>CPPP, Defence and state portals"]
        SPECIAL["Portal-Specific Adapters<br/>Karnataka, Bihar, Gujarat, Telangana, AP"]
        IREPS["IREPS Assisted Browser<br/>user completes official OTP"]
    end

    SCRAPE --> GEM
    SCRAPE --> GEPNIC
    SCRAPE --> SPECIAL
    SCRAPE --> IREPS

    subgraph DATA["Data Layer"]
        DB[("PostgreSQL")]
        PRISMA["Prisma ORM + Migrations"]
        BACKUPS["Timestamped JSON Backups"]
        PRISMA --> DB
    end

    AUTH --> PRISMA
    SEARCH --> PRISMA
    SCRAPE -->|"normalise, classify, hash, upsert"| PRISMA
    ALERTS --> PRISMA
    LIFECYCLE -->|"delete closed or suppressed tenders"| PRISMA
    ADMINAPI --> PRISMA
    ADMINAPI --> BACKUPS

    subgraph DELIVERY["Notification Layer"]
        SMTP["Encrypted SMTP Configuration"]
        GMAIL["SMTP Provider / Gmail"]
        RECIPIENTS["1-10 Alert Recipients"]
        SMTP --> GMAIL --> RECIPIENTS
    end

    ADMINAPI --> SMTP
    ALERTS -->|"deduplicated matched-tender digest"| SMTP
```

### Runtime Connection Map

```mermaid
sequenceDiagram
    participant Portal as Government Portal
    participant Adapter as Portal Adapter
    participant API as Express API
    participant DB as PostgreSQL
    participant Search as Search Service
    participant Mail as SMTP Provider
    participant User as Browser/User

    Portal->>Adapter: Public listing/API response
    Adapter->>API: Normalised PortalTender records
    API->>DB: Tombstone check + insert/update/deduplicate
    User->>API: Authenticated search and filters
    API->>Search: Ranked full-text query
    Search->>DB: Indexed cross-portal search
    DB-->>User: Paginated tender results
    API->>DB: Match active alert keywords after scrape
    API->>Mail: One deduplicated digest per subscription
    Mail-->>User: Tender alert to configured recipients
```

### Repository Structure

```text
.
|-- backend/
|   |-- prisma/                  # Schema and migrations
|   |-- scripts/                 # Backup restore utilities
|   |-- src/
|   |   |-- middleware/          # Authentication, admin checks, errors
|   |   |-- portals/             # Registry, adapter contract, portal adapters
|   |   |-- routes/              # Auth, tenders, scraping, alerts, admin APIs
|   |   |-- scheduler/           # Scrape, cleanup, alert, backup schedules
|   |   |-- services/            # Search, persistence, mail, auth, backups
|   |   `-- utils/               # Hashing, relevance, logging
|   `-- tests/                   # Unit, parser, database, service tests
|-- frontend/
|   `-- src/
|       |-- components/          # Dashboard and feature panels
|       |-- lib/                 # API client, auth context, keyword library
|       |-- pages/               # Home, login, signup
|       `-- styles/              # Application theme and responsive styles
|-- docs/                        # Portal feasibility and engineering notes
|-- scripts/                     # Smoke-test helpers
|-- docker-compose.yml
|-- start-backend.ps1
`-- start-frontend.ps1
```

## Data Flow

1. The scheduler or an admin starts an incremental or full scrape.
2. The orchestrator selects enabled entries from the portal registry.
3. Each adapter reads only its portal's public listing or API interface.
4. Adapter output is converted into the shared `PortalTender` format.
5. The backend computes relevance and a content hash.
6. The persistence service checks the permanent tombstone table.
7. PostgreSQL inserts new records, updates changed records, or skips unchanged and suppressed records.
8. Search queries rank stored open tenders and return paginated results.
9. After incremental scraping, active alert subscriptions are matched.
10. Successfully emailed tenders are recorded so the same user never receives the same tender twice.

## Portal Coverage

The registry currently contains these 22 sources:

1. Government e-Marketplace (GeM)
2. Central Public Procurement Portal (CPPP)
3. Defence eProcurement Portal
4. Maharashtra eProcurement
5. Karnataka eProcurement
6. Tamil Nadu eProcurement
7. Telangana eProcurement
8. Andhra Pradesh eProcurement
9. Uttar Pradesh eProcurement
10. Rajasthan eProcurement
11. Madhya Pradesh eProcurement
12. Haryana eProcurement
13. Punjab eProcurement
14. Kerala eProcurement
15. West Bengal eProcurement
16. Odisha eProcurement
17. Jharkhand eProcurement
18. Assam eProcurement
19. Bihar eProcurement
20. Indian Railways E-Procurement System (IREPS, assisted OTP flow)
21. Coal India e-Procurement
22. Gujarat eProcurement (nProcure)

See `docs/PORTAL_FEASIBILITY.md` for portal-specific interfaces and limitations.

## Prerequisites

### Native setup

- Node.js 20 or newer
- npm
- PostgreSQL 16 or a compatible managed PostgreSQL service
- Git

### Docker setup

- Docker Desktop with Docker Compose

## Quick Start with Docker

```bash
git clone https://github.com/Pawan8010/allportalsscraper.git
cd allportalsscraper
docker compose up --build
```

Open:

- Frontend: <http://localhost:3000>
- Backend health: <http://localhost:4000/health>
- PostgreSQL: `localhost:5432`

For real deployments, change the sample database password in `docker-compose.yml` and move secrets into environment variables or a secret manager.

## Native Installation

### 1. Clone and create PostgreSQL database

```bash
git clone https://github.com/Pawan8010/allportalsscraper.git
cd allportalsscraper
createdb tender_platform
```

### 2. Configure backend

PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

Bash:

```bash
cp backend/.env.example backend/.env
```

Set at minimum:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/tender_platform?schema=public"
PORT=4000
CORS_ALLOWED_ORIGINS="http://localhost:3000"
ADMIN_EMAILS="admin@example.com"
```

Generate the key used to encrypt SMTP passwords:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store the output as `MAIL_SETTINGS_KEY` in `backend/.env`.

### 3. Install and migrate backend

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
npm test
npm run dev
```

Backend: <http://localhost:4000>

### 4. Configure and run frontend

Open another terminal:

```bash
cd frontend
npm install
cp .env.example .env.local
npm run build
npm run dev
```

Frontend: <http://localhost:3000>

### Windows launch scripts

The repository includes `start-backend.ps1`, `start-frontend.ps1`, and equivalent `.bat` launchers.

## Environment Configuration

The complete template is `backend/.env.example`. Important variables include:

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | Backend HTTP port | `4000` |
| `CORS_ALLOWED_ORIGINS` | Allowed frontend origins | `http://localhost:3000` |
| `PORTAL_SCRAPE_ENABLED` | Global scraper switch | `true` |
| `PORTAL_CONCURRENCY` | Simultaneous portal scrapers | `3` |
| `GEPNIC_ORG_CONCURRENCY` | Concurrent organisation pages per GePNIC portal | `6` |
| `SCRAPE_CRON` | Incremental scrape schedule | Hourly |
| `FULL_SCRAPE_CRON` | Full sweep schedule | Daily at 03:00 |
| `SCRAPE_ON_STARTUP` | Run incremental scrape at startup | `true` |
| `TENDER_CLEANUP_ENABLED` | Remove closed tenders | `true` |
| `ADMIN_EMAILS` | Comma-separated admin allowlist | Empty |
| `SESSION_TTL_HOURS` | Session lifetime | `720` |
| `MAIL_SETTINGS_KEY` | Encrypts admin-saved SMTP password | Required for Admin SMTP |
| `BACKUP_ENABLED` | Enables scheduled backups | `true` |
| `BACKUP_RETENTION_DAYS` | Local backup retention | `14` |

Every portal also has an independent `PORTAL_<KEY>_ENABLED` setting.

## Authentication and Roles

- Passwords are hashed with bcrypt and never stored as plaintext.
- Browser sessions use an HTTP-only cookie.
- Only a SHA-256 hash of each raw session token is stored.
- Sessions record IP address, user agent, creation time, last activity, and expiry.
- Admin accounts are controlled by `ADMIN_EMAILS`.
- Admin-only APIs enforce authorization on the backend; hiding UI controls is not treated as security.
- Admins can inspect and revoke active sessions.

## Scraping

### Incremental scrape

Checks recent portal listings and is suitable for frequent execution.

### Full sweep

Walks all available pages and organisation listings. Full sweeps can take significant time and intentionally use conservative rate limits.

### Deduplication and updates

- Natural uniqueness: `(portal, tenderId)`.
- Content hashes prevent unnecessary database writes.
- `lastSeenAt` and `lastSeenRunId` record scraper observation history.
- A per-portal process lock prevents overlapping runs.
- One failing portal does not stop other portal scrapers.
- Interrupted runs are reconciled when the backend restarts.

### CAPTCHA and OTP

The application does not defeat access controls. GePNIC adapters use public organisation listings that do not require CAPTCHA. IREPS remains assisted because its guest workflow requires a real mobile number and OTP. The user completes verification in the opened browser session and then imports visible tender results.

## Search

Search runs against PostgreSQL rather than making a live request to every portal. This keeps results fast and reliable.

Supported search behaviour:

- title, tender ID, organisation, department, category, and descriptive fields;
- structured references containing `/`, `-`, and `_`;
- acronym and alias expansion;
- typo-tolerant similarity ranking;
- multi-keyword selection;
- multi-portal selection;
- relevance filtering;
- open-tender date filtering and pagination.

## Tender Relevance

Every scraped tender is classified automatically:

- **Relevant**: defence, surveillance, complete systems, and related equipment.
- **Parts/Non-defence**: spare parts, repair work, AMC, or clearly civilian requirements.
- **Unclassified**: insufficient evidence for a confident classification.

Classification is heuristic and should support review, not replace procurement judgment.

## Tender Lifecycle and Permanent Deletion

The daily cleanup job removes tenders after their closing date and creates a permanent tombstone. The scraper checks this tombstone before every insert or update.

Admins can also click **Delete permanently** on a search result. This operation:

1. requires backend admin authorization;
2. asks for browser confirmation;
3. creates or preserves the `(portal, tenderId)` tombstone;
4. deletes the tender in the same database transaction;
5. prevents every future incremental, full, or assisted scrape from restoring it.

## Email Alerts

Users can configure:

- one to ten recipient addresses independent of their login email, separated by commas;
- up to 50 keywords;
- whether the subscription is active.

After incremental scraping, the backend searches for matching tenders and sends one digest per user. `AlertSentLog` permanently prevents the same tender being sent twice to the same user. A failed email is not marked as sent, allowing a later retry.

### Configure SMTP in Admin Console

1. Set `MAIL_SETTINGS_KEY` in `backend/.env` and restart the backend.
2. Log in as an admin.
3. Open **Admin → Email delivery**.
4. Enter SMTP host, port, username, app password, and sender email.
5. Enable delivery and save.
6. Send a test email.
7. Use **Send matched alerts now** or wait for the next incremental scrape.

For Gmail, use a Google App Password, never the normal Google account password.

Database SMTP settings override legacy `SMTP_*` environment variables. The password is encrypted with AES-256-GCM and is never returned to the frontend.

## Backups and Restore

Scheduled backups export every database table to:

```text
backend/backups/<timestamp>/
```

Admins can run and list backups from the Admin Console. Restore is deliberately CLI-only.

```bash
cd backend
npx ts-node scripts/restore-backup.ts --dir backups/<timestamp> --confirm
```

The confirmation flag is required because restore operations overwrite database contents. Backups may contain sensitive user and SMTP configuration data and must not be committed.

## Important API Routes

All `/api` routes except authentication require a valid session.

| Method | Route | Access | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | API and database health |
| `POST` | `/api/auth/register` | Public | Create account |
| `POST` | `/api/auth/login` | Public | Password login |
| `GET` | `/api/auth/me` | User | Current user |
| `GET` | `/api/tenders/search` | User | Ranked tender search |
| `GET` | `/api/tenders/stats` | User | Dashboard statistics |
| `DELETE` | `/api/tenders/:id` | Admin | Permanently delete and suppress tender |
| `GET` | `/api/portals` | User | Portal health and counts |
| `POST` | `/api/scrape/all-portals` | User | Queue full sweep |
| `POST` | `/api/scrape/new-all-portals` | User | Queue incremental sweep |
| `GET/PUT` | `/api/alerts/subscription` | User | Alert settings |
| `GET` | `/api/alerts/history` | User | Delivered alert history |
| `GET/PUT` | `/api/admin/mail-settings` | Admin | SMTP configuration |
| `POST` | `/api/admin/mail-settings/test` | Admin | Send test email |
| `POST` | `/api/admin/alerts/run` | Admin | Run matched alerts immediately |
| `GET` | `/api/admin/sessions` | Admin | Session dashboard |
| `POST` | `/api/admin/backups/run` | Admin | Run backup |

## Testing and Validation

Backend:

```bash
cd backend
npm test
npm run lint
npm run build
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

Optional smoke test after both services are running:

```bash
bash scripts/smoke-test.sh
```

The backend suite covers authentication, session rules, portal parser fixtures, cross-portal search, unique constraints, scrape failure isolation, tender anti-resurrection, alerts, encrypted SMTP settings, cleanup, relevance, backups, and assisted IREPS row validation.

## Production Deployment Checklist

- Use a managed PostgreSQL instance with backups and TLS.
- Set `NODE_ENV=production`.
- Use strong, unique database credentials.
- Set exact HTTPS values in `CORS_ALLOWED_ORIGINS`.
- Generate a private `MAIL_SETTINGS_KEY` and store it in a secret manager.
- Configure a real admin allowlist through `ADMIN_EMAILS`.
- Run `npx prisma migrate deploy` before starting the backend.
- Terminate TLS at a reverse proxy or hosting platform.
- Keep the backend and database inaccessible from untrusted networks where possible.
- Monitor scraper failures and portal markup changes.
- Respect portal terms, public access rules, and conservative request rates.
- Never commit `.env`, database dumps, SMTP passwords, session cookies, or backup directories.

## Common Problems

### Frontend says the backend is unreachable

- Confirm <http://localhost:4000/health> responds.
- Check `NEXT_PUBLIC_API_BASE_URL`.
- Check `CORS_ALLOWED_ORIGINS` includes the exact frontend origin.
- Restart the frontend after changing `NEXT_PUBLIC_*` variables.

### Database connection fails

- Verify PostgreSQL is running.
- Verify `DATABASE_URL` starts with `postgresql://` or `postgres://`.
- Run `npx prisma migrate deploy` and `npx prisma generate`.

### Email test fails

- Use an SMTP app password, not the account password.
- Confirm host, port, and TLS mode.
- Confirm `MAIL_SETTINGS_KEY` exists before saving Admin settings.
- Check provider security restrictions and backend logs.

### A portal reports partial or interrupted scraping

Government servers can be slow or reset connections. The scraper retries requests, isolates failures, preserves completed records, and resumes on later scheduled runs. Reduce concurrency if a portal is unstable.

## Security and Legal Notes

- Scrape only public tender information you are permitted to access.
- Do not bypass CAPTCHA, OTP, login, paywalls, or technical access controls.
- Do not increase concurrency aggressively against government infrastructure.
- Search rankings and relevance labels are advisory.
- Protect user information, SMTP credentials, backups, and database access according to applicable law and organisational policy.

## License

No open-source license is currently included. Unless the repository owner adds one, all rights remain with the owner.
