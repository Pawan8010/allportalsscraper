import axios from "axios";
import { PortalAdapter, PortalAvailability, PortalTender, ScrapeOptions } from "../portal.types";
import { extractTenderCounts, parseClosingReport } from "./gujaratNprocureParser";
import { withRetry } from "../../utils/retry";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";

/**
 * Gujarat's real eProcurement domain is tender.nprocure.com, not
 * www.nprocure.com (the latter is a genuinely unreachable host from this
 * network -- see docs/PORTAL_FEASIBILITY.md, 27 Jul 2026 update). Its public
 * "Tender Closing Calendar" widget gives every date in the current month
 * with at least one tender closing, and a follow-up POST per date returns
 * that day's real tender list -- no login required. See
 * gujaratNprocureParser.ts for exactly how each response is parsed, and for
 * the one real limitation of this data source: no descriptive title, only
 * a Tender ID / IFB-Notice-Number / closing date per row.
 */
const BASE_URL = "https://tender.nprocure.com";
const CALENDAR_URL = `${BASE_URL}/dashboard/getTenderClosingData`;
const REPORT_URL = `${BASE_URL}/beforeLoginBidSubmissionClosingReport`;

async function fetchCalendarHtml(): Promise<string> {
  const res = await axios.get(CALENDAR_URL, {
    timeout: env.portalTimeoutMs,
    validateStatus: (s) => s < 500,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0)" },
  });
  if (res.status >= 400) {
    throw Object.assign(new Error(`HTTP ${res.status} on tender closing calendar`), { status: res.status });
  }
  return res.data ?? "";
}

async function fetchDayReport(date: string): Promise<string> {
  const params = new URLSearchParams();
  params.set("requestedDate", date);
  const res = await axios.post(REPORT_URL, params.toString(), {
    timeout: env.portalTimeoutMs,
    validateStatus: (s) => s < 500,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RRPGroupsTenderBot/1.0)",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: CALENDAR_URL,
    },
  });
  if (res.status >= 400) {
    throw Object.assign(new Error(`HTTP ${res.status} on closing report for ${date}`), { status: res.status });
  }
  return res.data ?? "";
}

export const gujaratNprocureAdapter: PortalAdapter = {
  key: "gujarat_nprocure",
  name: "Gujarat eProcurement (nProcure)",
  baseUrl: BASE_URL,
  supportsFullScrape: true,
  supportsIncrementalScrape: true,

  async checkAvailability(): Promise<PortalAvailability> {
    try {
      const html = await fetchCalendarHtml();
      const counts = extractTenderCounts(html);
      if (Object.keys(counts).length === 0) {
        return { available: false, reason: "blocked", detail: "Tender closing calendar returned no date data" };
      }
      return { available: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      return { available: false, reason: status ? "blocked" : "unreachable", detail: String(err) };
    }
  },

  async scrapeAll(options: ScrapeOptions): Promise<PortalTender[]> {
    const calendarHtml = await withRetry(() => fetchCalendarHtml(), { retries: env.portalMaxRetries });
    const counts = extractTenderCounts(calendarHtml);
    const dates = Object.keys(counts).sort();
    // The calendar widget's per-day counts are RAW ROW counts, not unique
    // tenders -- confirmed live 28 Jul 2026: one day (521 "tenders closing")
    // had only 393 distinct reference numbers, the other 128 being
    // additional lot/item rows under the same base tender. Summing these
    // across the month therefore overstates the real total and made the
    // coverage bar permanently stuck around 60% even once every real
    // tender had been captured. Used only as an in-progress "how far
    // through the calendar are we" signal; the run's *final* statedTotal
    // (below) is corrected to the true deduplicated count once known.
    const rawSum = Object.values(counts).reduce((sum, c) => sum + c, 0);

    const results: PortalTender[] = [];
    let pagesScanned = 0;

    for (const date of dates) {
      if (options.signal?.aborted) break;
      try {
        const html = await withRetry(() => fetchDayReport(date), { retries: env.portalMaxRetries });
        results.push(...parseClosingReport(html, "gujarat_nprocure"));
      } catch (err) {
        logger.warn({ portal: "gujarat_nprocure", date, err: String(err) }, "gujarat day report failed, skipping");
      }
      pagesScanned += 1;
      options.onProgress?.({ pagesScanned, tendersFound: results.length, statedTotal: rawSum });
      if (env.portalRequestDelayMs > 0) {
        await new Promise((r) => setTimeout(r, env.portalRequestDelayMs));
      }
    }

    // Multiple dates can list the same tender again if it spans several
    // closing batches on this portal, or if it's a multi-lot tender listed
    // as several rows under one reference number -- de-duplicate by
    // tenderId across the whole run, not just within a single day's report.
    const seen = new Set<string>();
    const deduped = results.filter((t) => {
      if (seen.has(t.tenderId)) return false;
      seen.add(t.tenderId);
      return true;
    });

    // Correct the final reported total to what's actually achievable (the
    // deduplicated count), not the raw pre-dedup sum -- otherwise the
    // coverage bar reads "62%, 2,506 to go" forever even with nothing real
    // left to find.
    options.onProgress?.({ pagesScanned, tendersFound: deduped.length, statedTotal: deduped.length });

    logger.info(
      { portal: "gujarat_nprocure", days: dates.length, rawRows: results.length, uniqueTenders: deduped.length },
      "gujarat_nprocure scrape complete"
    );
    return deduped;
  },

  async scrapeNew(options: ScrapeOptions): Promise<PortalTender[]> {
    return this.scrapeAll(options);
  },
};
