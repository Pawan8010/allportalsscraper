import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import { getPortalEntry } from "../portals/portalRegistry";
import { PortalRegistryEntry, PortalTender } from "../portals/portal.types";
import { prisma } from "./prisma";
import { upsertTenders } from "./portalScrapeService";
import { logger } from "../utils/logger";
import { parseAssistedDate } from "../utils/dateParser";

/**
 * For portals that are CAPTCHA/session-gated with no scriptable public API
 * (IREPS, Gujarat nProcure): rather than trying to defeat the CAPTCHA, this
 * opens a REAL, VISIBLE browser window on the machine running this backend
 * so a human can solve it and navigate to the public results themselves.
 * Only the page the human is already looking at gets imported -- nothing is
 * automated past that point except walking "next page" and reading what's
 * on screen, same as a human would.
 */

interface AssistedSession {
  id: string;
  portal: PortalRegistryEntry;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  expiresAt: Date;
  expiryTimer: NodeJS.Timeout;
}

const sessions = new Map<string, AssistedSession>();
// 21,747+ real results observed live on IREPS's "All Active Tenders" view
// (27 Jul 2026) -- at any plausible per-page row count that's several
// hundred to well over a thousand pages, so 250 was never going to be
// enough for a portal this size. Each page is just a DOM read + one click,
// so a generous cap costs time, not correctness.
const MAX_PAGES = 3000;
const MAX_SESSIONS = 4;
const SESSION_TTL_MS = 30 * 60 * 1000;

export class AssistedSessionError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

function assistedPortal(portalKey: string): PortalRegistryEntry {
  const portal = getPortalEntry(portalKey);
  if (!portal) throw new AssistedSessionError(`Unknown portal key: ${portalKey}`, 404);
  if (!portal.supportsAssistedScrape) {
    throw new AssistedSessionError(`${portal.name} does not support assisted sessions.`);
  }
  return portal;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new AssistedSessionError(
      "Playwright is not installed (`npm install playwright && npx playwright install chromium`), so an assisted browser session cannot be opened."
    );
  }
}

export async function startAssistedSession(portalKey: string) {
  const portal = assistedPortal(portalKey);

  const existing = Array.from(sessions.values()).find((s) => s.portal.key === portal.key);
  if (existing) {
    if (existing.browser.isConnected() && !existing.page.isClosed()) {
      await existing.page.bringToFront().catch(() => undefined);
      return {
        sessionId: existing.id,
        portal: portal.key,
        url: existing.page.url() || portal.baseUrl,
        instructions: "Continue in the already-open assisted browser window.",
        expiresAt: existing.expiresAt.toISOString(),
        reused: true,
      };
    }
    await cancelAssistedSession(existing.id);
  }
  if (sessions.size >= MAX_SESSIONS) {
    throw new AssistedSessionError("Too many assisted sessions are open. Close one and try again.", 429);
  }

  const startUrl = portal.assistedStartUrl ?? portal.baseUrl;
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  void page.goto(startUrl, { waitUntil: "commit", timeout: 60_000 }).catch(() => undefined);

  const id = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
  const expiryTimer = setTimeout(() => void cancelAssistedSession(id), SESSION_TTL_MS);
  expiryTimer.unref();

  sessions.set(id, { id, portal, browser, context, page, createdAt, expiresAt, expiryTimer });

  return {
    sessionId: id,
    portal: portal.key,
    url: startUrl,
    instructions:
      "In the browser window that just opened, solve any CAPTCHA and navigate to the public tender results list. Then call the import endpoint.",
    expiresAt: expiresAt.toISOString(),
  };
}

function clean(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// These evaluate() callbacks run inside the browser page, not this backend's
// Node process -- the backend's tsconfig has no "dom" lib (it doesn't need
// one anywhere else), so DOM element types aren't available here. `any` on
// the callback boundary is deliberate, not a shortcut: the real DOM types
// only exist in the page context this code is serialised into.
async function visibleRows(page: Page) {
  return page.locator('table tr, mat-row, .mat-row, [role="row"]').evaluateAll((elements: any[]) =>
    elements.map((el) => ({
      cells: Array.from(
        el.querySelectorAll(
          'th,td,mat-header-cell,mat-cell,.mat-header-cell,.mat-cell,[role="columnheader"],[role="cell"],[role="gridcell"]'
        )
      ).map((cell: any) => cell.textContent ?? ""),
      links: Array.from(el.querySelectorAll("a[href]")).map((a: any) => a.href),
    }))
  );
}

function parseRows(
  rows: Array<{ cells: string[]; links: string[] }>,
  portal: PortalRegistryEntry
): PortalTender[] {
  const tenders: PortalTender[] = [];
  for (const row of rows) {
    const cells = row.cells.map(clean).filter(Boolean);
    const text = cells.join(" | ");
    if (cells.length < 2) continue;
    if (/tender id|tender no|closing date|published date/i.test(text) && cells.length < 4) continue;

    const tenderId =
      text.match(/\b(?:GEM\/\d{4}\/[A-Z]\/\d+|[A-Z0-9][A-Z0-9_./-]{4,}\d)\b/i)?.[0] ??
      text.match(/\b\d{5,}\b/)?.[0];
    if (!tenderId) continue;

    const dateMatches = text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/gi) ?? [];
    // Parse each raw match into a real Date before storing it -- handing
    // an unparsed string like "29/07/2026 10:30" straight through used to
    // reach `new Date(...)` downstream, which reads slash-dates as
    // MM/DD/YYYY and silently produces an Invalid Date for any day above
    // 12. Prisma then rejects the whole row, not just the date field
    // (confirmed live: dropped 29 of 35 real IREPS rows, 28 Jul 2026).
    // Unparseable matches are dropped rather than passed through broken.
    const parsedDates = dateMatches
      .map((d) => parseAssistedDate(d))
      .filter((d): d is Date => d !== null);
    const title =
      cells
        .filter((cell) => cell !== tenderId && cell.length > 8 && !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(cell))
        .sort((a, b) => b.length - a.length)[0] ?? text;
    const absoluteLink = row.links.find((link) => /^https?:\/\//i.test(link)) ?? portal.baseUrl;

    tenders.push({
      portal: portal.key,
      tenderId,
      title,
      organisation: cells.find((c) => /department|ministry|division|corporation|railway|board/i.test(c)),
      tenderURL: absoluteLink,
      documentURL: absoluteLink,
      description: text,
      publishedDate: parsedDates[0]?.toISOString(),
      closingDate: parsedDates.at(-1)?.toISOString(),
      status: "active",
    });
  }
  return tenders;
}

export async function getAssistedSessionStatus(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) throw new AssistedSessionError("Assisted session was not found or has expired.", 404);

  const rows = await visibleRows(session.page).catch(() => []);
  const tenders = parseRows(rows, session.portal);
  const visibleCaptchaInputs = await session.page
    .locator('input[name*="captcha" i]:visible, input[id*="captcha" i]:visible, input[placeholder*="captcha" i]:visible')
    .count()
    .catch(() => 0);
  const bodyText = clean(await session.page.locator("body").innerText().catch(() => "")).slice(0, 10_000);
  const captchaVisible =
    visibleCaptchaInputs > 0 || (tenders.length === 0 && /captcha|verification code|security check/i.test(bodyText));

  return {
    sessionId,
    portal: session.portal.key,
    url: session.page.url(),
    detectedTenders: tenders.length,
    captchaVisible,
    expiresAt: session.expiresAt.toISOString(),
  };
}

const ROW_SELECTOR = 'table tr, mat-row, .mat-row, [role="row"]';

/** Table-row text only -- stable across pages that share identical header/nav
 *  chrome (see the comment on the dedup signature in importAssistedSession). */
async function rowsSignature(page: Page): Promise<string> {
  return clean(
    await page
      .locator(ROW_SELECTOR)
      .allInnerTexts()
      .then((rows) => rows.join("|"))
      .catch(() => "")
  );
}

async function clickNext(page: Page, pageNumber: number): Promise<boolean> {
  const previousRows = await rowsSignature(page);
  const nextPageNumber = String(pageNumber + 1);
  const candidates: { label: string; locator: ReturnType<Page["locator"]> }[] = [
    { label: "dataTables .next", locator: page.locator(".dataTables_paginate .next:not(.disabled) a") },
    { label: "bootstrap li.next", locator: page.locator("li.page-item.next:not(.disabled) a.page-link") },
    { label: "aria-label next page", locator: page.locator('button[aria-label*="next page" i]:not([disabled])') },
    { label: "[class*=pagination] next", locator: page.locator('[class*="pagination"] [class*="next"]:not(.disabled) a') },
    { label: "role=link next", locator: page.getByRole("link", { name: /^(next|next page|»|>>|>)$/i }) },
    { label: "role=button next", locator: page.getByRole("button", { name: /^(next|next page|»|>>|>)$/i }) },
    { label: "rel=next", locator: page.locator('a[rel="next"]') },
    // Classic ASP.NET WebForms GridView pagination: a postback link whose
    // __EVENTARGUMENT is literally "Next" (or "Page$Next"), or a plain link
    // reading "Next" not caught by the accessible-name query above because
    // the grid renders it as a raw <a> with no role/aria-label at all.
    { label: "__doPostBack Next", locator: page.locator('a[href*="__doPostBack"][href*="Next" i]') },
    { label: "plain <a>Next</a>", locator: page.locator("a").filter({ hasText: /^next$/i }) },
    // Icon-only controls: no visible text at all, just an image/SVG whose
    // alt/title says "next", or a link/button whose *only* accessible
    // signal is that attribute.
    { label: "img[alt*=next]", locator: page.locator('a:has(img[alt*="next" i]), a:has(img[title*="next" i])') },
    { label: "[title*=next]", locator: page.locator('a[title*="next" i], button[title*="next" i]') },
    // Numbered pagination with no distinct "Next" control at all -- click
    // the link/button whose visible text is literally the next page number.
    { label: `page number "${nextPageNumber}"`, locator: page.getByRole("link", { name: nextPageNumber, exact: true }) },
    { label: `page number button "${nextPageNumber}"`, locator: page.getByRole("button", { name: nextPageNumber, exact: true }) },
  ];
  const diagnostics: string[] = [];
  for (const { label, locator: raw } of candidates) {
    // A large results grid commonly repeats its pagination control at both
    // the top and bottom of the table -- requiring an exact single match
    // would skip every candidate on such a page and make clickNext() always
    // report "no next page", stopping the scrape after page 1 regardless of
    // how many real pages exist. Any match is fine; clicking either the top
    // or bottom control has the same effect.
    const count = await raw.count().catch(() => 0);
    if (count === 0) continue;
    const candidate = count === 1 ? raw : raw.first();
    const visible = await candidate.isVisible().catch(() => false);
    const enabled = visible && (await candidate.isEnabled().catch(() => false));
    diagnostics.push(`${label}: count=${count} visible=${visible} enabled=${enabled}`);
    if (!visible || !enabled) continue;
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined),
      candidate.click(),
    ]);
    await page
      .waitForFunction(
        // Runs in the browser page context, not Node -- see the comment on
        // visibleRows() above re: `document` and `any` here.
        ({ selector, previous }: { selector: string; previous: string }) => {
          const current = Array.from((globalThis as any).document.querySelectorAll(selector))
            .map((el: any) => el.textContent ?? "")
            .join("|")
            .replace(/\s+/g, " ")
            .trim();
          return Boolean(current) && current !== previous;
        },
        { selector: ROW_SELECTOR, previous: previousRows },
        { timeout: 15_000 }
      )
      .catch(() => undefined);
    return true;
  }
  // Every candidate came back empty/hidden/disabled -- log exactly what was
  // (and wasn't) found so the next attempt's logs say precisely why
  // pagination stopped here, instead of leaving it to guesswork.
  logger.warn({ pageNumber, diagnostics }, "clickNext: no working pagination control found");
  return false;
}

export async function importAssistedSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) throw new AssistedSessionError("Assisted session was not found or has expired.", 404);

  // The 30-minute expiry timer exists to reclaim a browser a human opened
  // and then abandoned -- it must not still be armed once a real import is
  // under way. IREPS alone has 21,747+ results across hundreds to
  // thousands of pages, so walking every page (plus whatever time was
  // already spent solving the CAPTCHA/OTP before import was even called)
  // routinely takes well over 30 minutes. Left armed, the timer fires
  // mid-loop and force-closes the browser out from under the in-progress
  // Playwright calls, surfacing as "locator.evaluateAll: Target page,
  // context or browser has been closed" (confirmed live, 29 Jul 2026) --
  // not a pagination-selector bug, a session-lifetime one. MAX_PAGES and
  // clickNext()'s own per-page timeouts remain as the real upper bounds.
  clearTimeout(session.expiryTimer);

  const run = await prisma.scrapeRun.create({
    data: { portal: session.portal.key, mode: "assisted", status: "running" },
  });

  let pagesScanned = 0;
  let found = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const seenPages = new Set<string>();
  

  try {
    while (pagesScanned < MAX_PAGES) {
      // Table-row text, not whole-page body text: pages with a lot of shared
      // header/nav chrome (menus, notices, search bar -- exactly what a real
      // government portal like IREPS has above its results table) can have
      // an IDENTICAL first-N-characters of body text across genuinely
      // different pages, which made this loop think it had looped back to
      // an already-seen page after just 1-2 real pages and stop -- observed
      // live: a session with 21,747 real results only imported 2 pages / 34
      // tenders before this signature falsely matched. Row text changes
      // with the actual data, so it doesn't have this false-positive risk.
      const signature = await rowsSignature(session.page);
      if (seenPages.has(signature)) break;
      seenPages.add(signature);

      const tenders = parseRows(await visibleRows(session.page), session.portal);
      const counts = await upsertTenders(tenders, session.portal.name, run.id);
      pagesScanned += 1;
      found += tenders.length;
      inserted += counts.inserted;
      updated += counts.updated;
      skipped += counts.skipped;
      failed += counts.failed;

      if (!(await clickNext(session.page, pagesScanned))) break;
    }

    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "success", pagesScanned, tendersFound: found, inserted, updated, skipped, failed, finishedAt: new Date() },
    });

    return { runId: run.id, portal: session.portal.key, pagesScanned, found, inserted, updated, skipped };
  } catch (err) {
    logger.error({ err: String(err), portal: session.portal.key }, "assisted import failed");
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "failed", errorMessage: String(err), finishedAt: new Date() },
    });
    throw err;
  } finally {
    // expiryTimer was already cleared before the loop started, above.
    sessions.delete(sessionId);
    const delayedClose = setTimeout(() => {
      void session.context.close().catch(() => undefined);
      void session.browser.close().catch(() => undefined);
    }, 90_000);
    delayedClose.unref();
  }
}

export async function cancelAssistedSession(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;
  sessions.delete(sessionId);
  clearTimeout(session.expiryTimer);
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
  return true;
}

export function listAssistedSessions() {
  return Array.from(sessions.values()).map((s) => ({
    sessionId: s.id,
    portal: s.portal.key,
    expiresAt: s.expiresAt.toISOString(),
  }));
}
