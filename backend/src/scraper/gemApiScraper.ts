import { config } from "../config/env";
import { RawScrapedTender } from "../types/scraper";

const GEM_LISTING_URL = `${config.gemBaseUrl}/all-bids`;
const GEM_DATA_URL = `${config.gemBaseUrl}/all-bids-data`;
const PAGE_SIZE = 10;

type GemBid = Record<string, unknown>;

/**
 * Single HTTP entry point for the scraper, on Node's built-in fetch.
 *
 * This used to shell out to curl once per page, which spawned a process and
 * created + deleted a temp directory for every one of the ~4,800 pages in a full
 * sweep. Native fetch keeps connections pooled and removes that per-page cost.
 */
async function requestText(
  url: string,
  options: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string } = {}
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.scraperTimeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.method === "POST" ? options.body : undefined,
      redirect: "follow",
      signal: controller.signal,
    });

    const headers: Record<string, string | string[] | undefined> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    // Set-Cookie is the one header that legitimately repeats, and folding the
    // copies into one comma-joined string corrupts cookies containing commas.
    if (typeof response.headers.getSetCookie === "function") {
      const setCookie = response.headers.getSetCookie();
      if (setCookie.length > 0) headers["set-cookie"] = setCookie;
    }

    return { statusCode: response.status, headers, body: await response.text() };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${config.scraperTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function firstValue<T = unknown>(value: unknown): T | null {
  if (Array.isArray(value)) return value.length ? (value[0] as T) : null;
  return value === undefined || value === null ? null : (value as T);
}

function clean(value: unknown): string | null {
  const raw = firstValue(value);
  if (raw === null) return null;
  const text = String(raw).replace(/\s+/g, " ").trim();
  return text || null;
}

function csrfFromHtml(html: string): string {
  const match = html.match(/csrf_bd_gem_nk['"]?\s*[:=]\s*['"]([^'"]+)/);
  if (!match) throw new Error("Unable to read GeM CSRF token from all-bids page");
  return match[1];
}

function cookiesFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["set-cookie"];
  const cookieHeaders = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookieHeaders
    .flatMap((header) => header.split(/,(?=\s*[^;,]+=)/))
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function payload(page: number, sort = "Bid-End-Date-Oldest", searchTerm = "") {
  const data: Record<string, unknown> = {
    param: { searchBid: searchTerm, searchType: "fullText" },
    filter: {
      bidStatusType: "ongoing_bids",
      byType: "all",
      highBidValue: "",
      byEndDate: { from: "", to: "" },
      sort,
    },
  };
  if (page > 1) data.page = page;
  return data;
}

async function fetchFirstPageSession() {
  const response = await requestText(GEM_LISTING_URL, {
    headers: {
      "user-agent": config.scraperUserAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GeM listing returned HTTP ${response.statusCode}`);
  }
  const html = response.body;
  return {
    csrf: csrfFromHtml(html),
    cookie: cookiesFromHeaders(response.headers),
  };
}

async function fetchGemDataPage(csrf: string, cookie: string, page: number, sort?: string, searchTerm?: string) {
  const body = new URLSearchParams({
    payload: JSON.stringify(payload(page, sort, searchTerm)),
    csrf_bd_gem_nk: csrf,
  });

  const response = await requestText(GEM_DATA_URL, {
    method: "POST",
    headers: {
      "user-agent": config.scraperUserAgent,
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      origin: config.gemBaseUrl,
      referer: GEM_LISTING_URL,
      "x-requested-with": "XMLHttpRequest",
      cookie,
      "content-length": Buffer.byteLength(body.toString()).toString(),
    },
    body: body.toString(),
  });

  // A search term GeM has no bids for answers 404 with {"code":404,
  // "message":"No data found"}. That is an empty result set, not a failure:
  // treating it as an error burned the retry budget and logged a scary warning
  // for what is simply "nothing matched".
  const emptyResult = { numFound: 0, start: 0, docs: [] as GemBid[] };
  if (response.statusCode === 404 && /no data found/i.test(response.body)) {
    return emptyResult;
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GeM data page ${page} returned HTTP ${response.statusCode}: ${response.body.slice(0, 200)}`);
  }

  const json = JSON.parse(response.body) as any;
  if (json.code === 404) return emptyResult;
  if (json.code !== 200) throw new Error(`GeM rejected page ${page}: ${json.message ?? "unknown error"}`);
  return json.response.response as { numFound: number; start: number; docs: GemBid[] };
}

/**
 * Exponential backoff with jitter. Retrying a rate-limited portal on a fixed
 * cadence just re-collides, and the jitter also de-synchronises the concurrent
 * page workers after a shared failure.
 */
export function backoffDelayMs(attempt: number, baseDelayMs = 500, random: () => number = Math.random): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, 30_000);
  return Math.round(capped * (0.5 + random() * 0.5));
}

async function fetchGemDataPageWithRetry(csrf: string, cookie: string, page: number, sort?: string, searchTerm?: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.scraperMaxRetries; attempt += 1) {
    try {
      return await fetchGemDataPage(csrf, cookie, page, sort, searchTerm);
    } catch (error) {
      lastError = error;
      if (attempt < config.scraperMaxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function mapGemBid(bid: GemBid): RawScrapedTender | null {
  const tenderId = clean(bid.b_bid_number);
  const bidNumericId = clean(bid.b_id) ?? clean(bid.id);

  // GeM truncates b_category_name to ~100 characters for display; the full item
  // list lives in bd_category_name. Prefer the untruncated value so the title
  // and the search vector both see the whole thing.
  const fullItems = clean(bid.bd_category_name);
  const shortItems = clean(bid.b_category_name);
  const boqTitle = clean(bid.bbt_title);
  const title = fullItems ?? shortItems ?? boqTitle;
  if (!tenderId || !title) return null;

  // Mirrors the URL the all-bids page itself builds for each card.
  const bidType = firstValue<number>(bid.b_bid_type);
  const evalType = firstValue<number>(bid.b_eval_type) ?? 0;
  let documentPath = "showbidDocument";
  if (bidType === 5) documentPath = "showdirectradocumentPdf";
  if (bidType === 2) documentPath = evalType > 0 ? "list-ra-schedules" : "showradocumentPdf";
  const documentURL = bidNumericId ? `${config.gemBaseUrl}/${documentPath}/${bidNumericId}` : GEM_LISTING_URL;

  const ministry = clean(bid.ba_official_details_minName);
  const department = clean(bid.ba_official_details_deptName);
  const organisation = clean(bid.ba_official_details_orgName) ?? ministry;
  const quantity = clean(bid.b_total_quantity);
  const isRateContract = firstValue<number>(bid.is_rc_bid) === 1;
  const isGlobalTender = firstValue<number>(bid.ba_is_global_tendering) === 1;

  return {
    tenderId,
    title,
    organisation,
    // Ministry and department are distinct fields on GeM; keep them that way
    // rather than writing the ministry into both.
    department: department ?? ministry,
    // The public all-bids listing carries no delivery location or state - those
    // are only on the bid document. Left null so the UI can say "not listed"
    // instead of showing an invented value.
    location: null,
    state: null,
    category: boqTitle ?? "GeM Bid",
    description: [
      title,
      boqTitle,
      ministry,
      department,
      organisation,
      quantity ? `Quantity: ${quantity}` : null,
      isRateContract ? "Rate Contract" : null,
      isGlobalTender ? "Global Tender" : null,
    ]
      .filter(Boolean)
      .join(" | "),
    estimatedValueText: clean(bid.b_total_value),
    publishedDateText: clean(bid.final_start_date_sort),
    closingDateText: clean(bid.final_end_date_sort),
    tenderURL: documentURL,
    documentURL,
    // Only ongoing bids are requested, but the status is still derived from the
    // closing date so a bid that expired mid-scrape is not recorded as LIVE.
    statusText: null,
  };
}

export interface GemApiScrapeOptions {
  maxPages?: number;
  sort?: string;
  startPage?: number;
  searchTerm?: string;
  /**
   * Explicit page numbers to fetch, in addition to the normal sweep. Used to
   * re-attempt the pages an interrupted run recorded as failed.
   */
  retryPages?: number[];
  /** Called for every page that failed after all retries. */
  onPageError?: (page: number, error: Error) => void;
  /** Called once GeM reports how many results the query actually has. */
  onTotalKnown?: (statedTotal: number, maxAvailablePages: number) => void;
}

export interface GemApiScrapeResult {
  tenders: RawScrapedTender[];
  pagesScraped: number;
  statedTotal: number;
  failedPages: number[];
  maxAvailablePages: number;
}

export async function scrapeGemApi(
  onPage?: (tenders: RawScrapedTender[], page: number, statedTotal: number) => Promise<void>,
  options: GemApiScrapeOptions = {}
): Promise<GemApiScrapeResult> {
  const { csrf, cookie } = await fetchFirstPageSession();
  const firstPage = await fetchGemDataPage(csrf, cookie, 1, options.sort, options.searchTerm);

  // GeM's own reported result count for this query. Never assume a figure -
  // pagination stops where the portal says the results stop.
  const statedTotal = Number(firstPage.numFound || 0);
  const maxAvailablePages = Math.max(1, Math.ceil(statedTotal / PAGE_SIZE));
  options.onTotalKnown?.(statedTotal, maxAvailablePages);

  const configuredMaxPages = options.maxPages ?? config.scraperMaxPages;
  const maxPages = configuredMaxPages > 0 ? Math.min(configuredMaxPages, maxAvailablePages) : maxAvailablePages;
  const configuredStartPage = options.startPage ?? config.scraperStartPage;
  const startPage = Math.min(Math.max(1, configuredStartPage), maxPages);

  const tenders: RawScrapedTender[] = [];
  let pagesScraped = 0;

  const handlePage = async (page: number, pageData: { docs: GemBid[] }) => {
    pagesScraped = Math.max(pagesScraped, page);
    const mapped = (pageData.docs || []).map(mapGemBid).filter((item): item is RawScrapedTender => Boolean(item));
    tenders.push(...mapped);
    if (onPage) await onPage(mapped, page, statedTotal);
    return mapped.length;
  };

  const failedPages = new Set<number>();
  const reportFailure = (page: number, error: unknown) => {
    failedPages.add(page);
    options.onPageError?.(page, error instanceof Error ? error : new Error(String(error)));
  };

  if (startPage <= 1) {
    await handlePage(1, firstPage);
  }

  // Pages an earlier interrupted run failed on get re-attempted first: upserts
  // are idempotent, so overlapping work is safe and closes gaps.
  const queue: number[] = [];
  for (const page of options.retryPages ?? []) {
    if (page >= 1 && page <= maxPages) queue.push(page);
  }

  const concurrency = Math.max(1, config.scraperApiConcurrency);
  let nextPage = Math.max(2, startPage);
  let exhausted = false;

  const takeNextPage = (): number | null => {
    if (queue.length > 0) return queue.shift() as number;
    if (exhausted) return null;
    const page = nextPage;
    nextPage += 1;
    if (page > maxPages) return null;
    return page;
  };

  async function worker() {
    for (;;) {
      const page = takeNextPage();
      if (page === null) return;
      try {
        const pageData = await fetchGemDataPageWithRetry(csrf, cookie, page, options.sort, options.searchTerm);
        const count = await handlePage(page, pageData);
        // An empty page means the portal has run out of results early.
        if (count === 0) exhausted = true;
      } catch (error) {
        reportFailure(page, error);
      }
      if (config.scraperRequestDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.scraperRequestDelayMs));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // One final sweep over everything that still failed, with a fresh session in
  // case the CSRF token or cookies expired during a long run.
  if (failedPages.size > 0) {
    const stillFailed = Array.from(failedPages);
    failedPages.clear();
    let session = { csrf, cookie };
    try {
      session = await fetchFirstPageSession();
    } catch {
      // Keep the original session; the per-page retry will report the failure.
    }
    for (const page of stillFailed) {
      try {
        const pageData = await fetchGemDataPageWithRetry(session.csrf, session.cookie, page, options.sort, options.searchTerm);
        await handlePage(page, pageData);
      } catch (error) {
        reportFailure(page, error);
      }
    }
  }

  return {
    tenders,
    pagesScraped,
    statedTotal,
    failedPages: Array.from(failedPages).sort((left, right) => left - right),
    maxAvailablePages,
  };
}
