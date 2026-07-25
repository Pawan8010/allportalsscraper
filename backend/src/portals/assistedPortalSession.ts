import { Browser, BrowserContext, chromium, Page } from "playwright";
import { randomUUID } from "node:crypto";
import { upsertScrapedTenders } from "../services/tenderService";
import { RawScrapedTender } from "../types/scraper";
import { PortalDefinition, getPortal } from "./portalRegistry";

type AssistedSession = {
  id: string;
  portal: PortalDefinition;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  expiresAt: Date;
  expiryTimer: NodeJS.Timeout;
  readySignature: string | null;
  readyObservations: number;
};

const sessions = new Map<string, AssistedSession>();
const MAX_PAGES = 250;
const MAX_SESSIONS = 6;
const SESSION_TTL_MS = 30 * 60 * 1000;

export class AssistedSessionError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

function assistedPortal(portalKey: string) {
  const portal = getPortal(portalKey);
  if (!portal) throw new AssistedSessionError(`Unknown portal: ${portalKey}`, 404);
  if (!portal.supportsAssistedScrape) {
    throw new AssistedSessionError(`${portal.name} does not require an assisted session.`);
  }
  return portal;
}

export async function startAssistedSession(portalKey: string) {
  const portal = assistedPortal(portalKey);
  const existingSession = Array.from(sessions.values()).find(
    (session) => session.portal.key === portal.key
  );
  if (existingSession) {
    if (existingSession.browser.isConnected() && !existingSession.page.isClosed()) {
      await existingSession.page.bringToFront().catch(() => undefined);
      return {
        sessionId: existingSession.id,
        portal: portal.shortName,
        url: existingSession.page.url() || portal.baseUrl,
        instructions:
          "Continue in the already-open assisted browser. Solve CAPTCHA if shown and remain on the public tender results page.",
        expiresAt: existingSession.expiresAt.toISOString(),
        reused: true,
      };
    }
    await cancelAssistedSession(existingSession.id);
  }
  if (sessions.size >= MAX_SESSIONS) {
    throw new AssistedSessionError("Too many assisted sessions are open. Close one and try again.", 429);
  }
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  void page.goto(portal.baseUrl, { waitUntil: "commit", timeout: 60_000 }).catch(() => undefined);

  const id = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
  const expiryTimer = setTimeout(() => {
    void cancelAssistedSession(id);
  }, SESSION_TTL_MS);
  expiryTimer.unref();
  sessions.set(id, {
    id,
    portal,
    browser,
    context,
    page,
    createdAt,
    expiresAt,
    expiryTimer,
    readySignature: null,
    readyObservations: 0,
  });
  return {
    sessionId: id,
    portal: portal.shortName,
    url: portal.baseUrl,
    instructions:
      "In the opened browser, solve CAPTCHA if shown and navigate to the public active-tender result list. Then click Import Visible Tender Pages in the dashboard.",
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getAssistedSessionStatus(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) throw new AssistedSessionError("Assisted session was not found or has expired.", 404);

  const rows = await visibleRows(session.page).catch(() => []);
  const tenders = parseRows(rows, session.portal);
  const visibleCaptchaInputs = await session.page
    .locator(
      'input[name*="captcha" i]:visible, input[id*="captcha" i]:visible, input[placeholder*="captcha" i]:visible'
    )
    .count()
    .catch(() => 0);
  const bodyText = clean(
    await session.page
      .locator("body")
      .innerText()
      .catch(() => "")
  ).slice(0, 10_000);
  const captchaVisible =
    visibleCaptchaInputs > 0 ||
    (tenders.length === 0 && /captcha|verification code|security check/i.test(bodyText));
  const readySignature = tenders.length > 0 ? `${session.page.url()}|${tenders.length}` : null;
  if (readySignature && readySignature === session.readySignature) {
    session.readyObservations += 1;
  } else {
    session.readySignature = readySignature;
    session.readyObservations = readySignature ? 1 : 0;
  }

  return {
    sessionId,
    portal: session.portal.shortName,
    url: session.page.url(),
    ready: session.readyObservations >= 3,
    detectedTenders: tenders.length,
    stableChecks: session.readyObservations,
    captchaVisible,
    expiresAt: session.expiresAt.toISOString(),
  };
}

function clean(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseRows(rows: Array<{ cells: string[]; links: string[] }>, portal: PortalDefinition): RawScrapedTender[] {
  const tenders: RawScrapedTender[] = [];
  for (const row of rows) {
    const cells = row.cells.map(clean).filter(Boolean);
    const text = cells.join(" | ");
    if (cells.length < 2 || /tender id|tender no|closing date|published date/i.test(text) && cells.length < 4) continue;

    const id =
      text.match(/\b(?:GEM\/\d{4}\/[A-Z]\/\d+|[A-Z0-9][A-Z0-9_./-]{4,}\d)\b/i)?.[0] ??
      text.match(/\b\d{5,}\b/)?.[0];
    if (!id) continue;

    const dateMatches = text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/gi) ?? [];
    const title =
      cells
        .filter((cell) => cell !== id && cell.length > 8 && !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(cell))
        .sort((left, right) => right.length - left.length)[0] ?? text;
    const absoluteLink = row.links.find((link) => /^https?:\/\//i.test(link)) ?? portal.baseUrl;

    tenders.push({
      portal: portal.shortName,
      tenderId: id,
      title,
      organisation: cells.find((cell) => /department|ministry|division|corporation|railway|board/i.test(cell)) ?? null,
      department: null,
      location: portal.state ?? "India",
      state: portal.state ?? null,
      category: `${portal.shortName} Tender`,
      description: text,
      estimatedValueText: null,
      publishedDateText: dateMatches[0] ?? null,
      closingDateText: dateMatches.at(-1) ?? null,
      tenderURL: absoluteLink,
      documentURL: absoluteLink,
      statusText: "LIVE",
    });
  }
  return tenders;
}

async function visibleRows(page: Page) {
  return page.locator('table tr, mat-row, .mat-row, [role="row"]').evaluateAll((elements) =>
    elements.map((element) => ({
      cells: Array.from(
        element.querySelectorAll('th,td,mat-header-cell,mat-cell,.mat-header-cell,.mat-cell,[role="columnheader"],[role="cell"],[role="gridcell"]')
      ).map((cell) => cell.textContent ?? ""),
      links: Array.from(element.querySelectorAll("a[href]")).map((link) => (link as HTMLAnchorElement).href),
    }))
  );
}

async function clickNext(page: Page) {
  const previousRows = clean(
    await page
      .locator('table tr, mat-row, .mat-row, [role="row"]')
      .allInnerTexts()
      .then((rows) => rows.join("|"))
      .catch(() => "")
  );
  const candidates = [
    page.locator(".dataTables_paginate .next:not(.disabled) a"),
    page.locator("li.page-item.next:not(.disabled) a.page-link"),
    page.locator('button[aria-label*="next page" i]:not([disabled])'),
    page.locator('button[title*="next" i]:not([disabled])'),
    page.locator(".mat-paginator-navigation-next:not([disabled])"),
    page.locator('[class*="pagination"] [class*="next"]:not(.disabled) a'),
    page.locator('[class*="pagination"] button[class*="next"]:not([disabled])'),
    page.getByRole("link", { name: /^(next|next page|>)$/i }),
    page.getByRole("button", { name: /^(next|next page|>)$/i }),
    page.locator('a[rel="next"]'),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) !== 1) continue;
    if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) continue;
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined),
      candidate.click(),
    ]);
    await page
      .waitForFunction(
        ({ selector, previous }) => {
          const current = Array.from(document.querySelectorAll(selector))
            .map((element) => element.textContent ?? "")
            .join("|")
            .replace(/\s+/g, " ")
            .trim();
          return Boolean(current) && current !== previous;
        },
        {
          selector: 'table tr, mat-row, .mat-row, [role="row"]',
          previous: previousRows,
        },
        { timeout: 15_000 }
      )
      .catch(() => undefined);
    return true;
  }
  return false;
}

async function maximizeVisiblePageSize(page: Page) {
  const selectors = page.locator('select[name$="_length"], select[aria-label*="entries" i]');
  const count = await selectors.count();
  for (let index = 0; index < count; index += 1) {
    const selector = selectors.nth(index);
    if (!(await selector.isVisible())) continue;
    const values = await selector.locator("option").evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value)
        .filter((value) => /^\d+$/.test(value))
        .sort((left, right) => Number(right) - Number(left))
    );
    if (!values[0]) continue;
    await selector.selectOption(values[0]);
    await page.waitForTimeout(750);
  }
}

export async function importAssistedSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) throw new AssistedSessionError("Assisted session was not found or has expired.", 404);

  let pagesScanned = 0;
  let found = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const seenPages = new Set<string>();

  try {
    await maximizeVisiblePageSize(session.page);
    while (pagesScanned < MAX_PAGES) {
      const signature = `${session.page.url()}|${clean(await session.page.locator("body").innerText()).slice(0, 500)}`;
      if (seenPages.has(signature)) break;
      seenPages.add(signature);

      const tenders = parseRows(await visibleRows(session.page), session.portal);
      const counts = await upsertScrapedTenders(tenders);
      pagesScanned += 1;
      found += tenders.length;
      inserted += counts.inserted;
      updated += counts.updated;
      skipped += counts.skipped;

      if (!(await clickNext(session.page))) break;
    }
    return { portal: session.portal.shortName, pagesScanned, found, inserted, updated, skipped };
  } finally {
    sessions.delete(sessionId);
    clearTimeout(session.expiryTimer);
    const delayedClose = setTimeout(() => {
      void session.context.close().catch(() => undefined);
      void session.browser.close().catch(() => undefined);
    }, 90_000);
    delayedClose.unref();
  }
}

export async function cancelAssistedSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  sessions.delete(sessionId);
  clearTimeout(session.expiryTimer);
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
  return true;
}
