import { config } from "../config/env";
import { logger } from "../utils/logger";
import { scrapeGemApi } from "../scraper/gemApiScraper";
import { upsertScrapedTenders } from "./tenderService";

/**
 * Optional live sync against GeM's public search, used to keep the stored
 * corpus current for terms people actually search for.
 *
 * The important property is that a search request NEVER waits on GeM. A request
 * reads whatever snapshot is already cached and, if that snapshot is missing or
 * stale, schedules a background refresh and returns immediately. Blocking the
 * request on a multi-page scrape is what produced the "Failed to fetch" errors:
 * the browser timed out long before GeM finished paginating.
 */

export type LiveSyncState = "fresh" | "refreshing" | "stale" | "unavailable" | "disabled";

interface LiveSnapshot {
  term: string;
  /** Bid numbers in the order GeM returned them. */
  tenderIds: string[];
  /** GeM's own reported result count for this term. Never hard-coded. */
  statedTotal: number;
  syncedAt: Date;
  expiresAt: number;
  failedPages: number;
}

const snapshots = new Map<string, LiveSnapshot>();
const inFlight = new Map<string, Promise<void>>();
/** Terms whose last sync attempt failed, so we can report honestly. */
const lastError = new Map<string, string>();

/** Bounded background concurrency so a burst of typing cannot fan out to GeM. */
const MAX_CONCURRENT_SYNCS = 2;

function cacheKey(term: string): string {
  return term.replace(/\s+/g, " ").trim().toLowerCase();
}

function isFresh(snapshot: LiveSnapshot | undefined): snapshot is LiveSnapshot {
  return Boolean(snapshot && snapshot.expiresAt > Date.now());
}

/**
 * Scrapes GeM's public search for one term and upserts every page as it
 * arrives, so a partial run still leaves the database better off.
 */
async function syncTerm(term: string): Promise<void> {
  const key = cacheKey(term);
  const seen = new Set<string>();
  const orderedTenderIds: string[] = [];

  try {
    logger.info(`[liveSearch] Background GeM sync started for "${term}"`);
    const result = await scrapeGemApi(
      async (pageTenders) => {
        const uniquePage = pageTenders.filter((tender) => {
          if (seen.has(tender.tenderId)) return false;
          seen.add(tender.tenderId);
          orderedTenderIds.push(tender.tenderId);
          return true;
        });
        if (uniquePage.length > 0) {
          await upsertScrapedTenders(uniquePage);
        }
      },
      {
        searchTerm: term,
        sort: "Bid-End-Date-Oldest",
        startPage: 1,
        maxPages: config.liveSearchMaxPages,
      }
    );

    snapshots.set(key, {
      term,
      tenderIds: orderedTenderIds,
      statedTotal: result.statedTotal,
      syncedAt: new Date(),
      expiresAt: Date.now() + config.liveSearchTtlMs,
      failedPages: result.failedPages.length,
    });
    lastError.delete(key);

    logger.info(
      `[liveSearch] Synced "${term}": gemStatedTotal=${result.statedTotal}, stored=${orderedTenderIds.length}, pages=${result.pagesScraped}, failedPages=${result.failedPages.length}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastError.set(key, message);
    logger.warn(`[liveSearch] GeM sync failed for "${term}": ${message}`);
  }
}

/** Starts a sync unless one is already running for this term or we are at capacity. */
function scheduleSync(term: string): boolean {
  const key = cacheKey(term);
  if (inFlight.has(key)) return true;
  if (inFlight.size >= MAX_CONCURRENT_SYNCS) return false;

  const promise = syncTerm(term).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  // Deliberately not awaited: the caller is serving an HTTP request.
  void promise;
  return true;
}

export interface LiveSearchStatus {
  state: LiveSyncState;
  /** GeM order for every term with a usable snapshot, deduplicated. */
  orderedTenderIds: string[];
  /** Sum of GeM's stated totals across the searched terms, when known. */
  gemStatedTotal: number | null;
  syncedAt: string | null;
  terms: Array<{ term: string; state: LiveSyncState; gemStatedTotal: number | null; error?: string }>;
}

/**
 * Returns the cached GeM view of the given terms and schedules refreshes.
 * Always returns synchronously fast - it performs no network I/O itself.
 */
export function getLiveSearchStatus(terms: string[]): LiveSearchStatus {
  if (!config.liveSearchEnabled || terms.length === 0) {
    return {
      state: config.liveSearchEnabled ? "disabled" : "disabled",
      orderedTenderIds: [],
      gemStatedTotal: null,
      syncedAt: null,
      terms: [],
    };
  }

  const perTerm: LiveSearchStatus["terms"] = [];
  const orderedTenderIds: string[] = [];
  const seen = new Set<string>();
  let newestSync: Date | null = null;
  let statedTotal = 0;
  let anyStated = false;

  for (const term of terms) {
    const key = cacheKey(term);
    const snapshot = snapshots.get(key);
    const error = lastError.get(key);

    let state: LiveSyncState;
    if (isFresh(snapshot)) {
      state = "fresh";
    } else if (inFlight.has(key)) {
      state = "refreshing";
    } else if (scheduleSync(term)) {
      state = snapshot ? "stale" : "refreshing";
    } else {
      state = snapshot ? "stale" : "unavailable";
    }

    if (snapshot) {
      for (const tenderId of snapshot.tenderIds) {
        if (seen.has(tenderId)) continue;
        seen.add(tenderId);
        orderedTenderIds.push(tenderId);
      }
      statedTotal += snapshot.statedTotal;
      anyStated = true;
      if (!newestSync || snapshot.syncedAt > newestSync) newestSync = snapshot.syncedAt;
    }

    perTerm.push({
      term,
      state,
      gemStatedTotal: snapshot?.statedTotal ?? null,
      ...(error && !snapshot ? { error } : {}),
    });
  }

  const overall: LiveSyncState = perTerm.every((entry) => entry.state === "fresh")
    ? "fresh"
    : perTerm.some((entry) => entry.state === "refreshing")
      ? "refreshing"
      : perTerm.some((entry) => entry.state === "stale")
        ? "stale"
        : "unavailable";

  return {
    state: overall,
    orderedTenderIds,
    gemStatedTotal: anyStated ? statedTotal : null,
    syncedAt: newestSync ? newestSync.toISOString() : null,
    terms: perTerm,
  };
}

/** Test/ops helper - drops every cached snapshot. */
export function resetLiveSearchCache(): void {
  snapshots.clear();
  lastError.clear();
}
