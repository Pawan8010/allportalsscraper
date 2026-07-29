import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, Search } from "lucide-react";
import {
  getPortals,
  getStats,
  searchTenders,
  triggerScrapeAll,
  getScrapeRuns,
  PortalSummary,
  StatsResponse,
  TenderRow,
  ApiError,
  PAGE_SIZE,
} from "@/lib/api";
import { useToast } from "@/lib/toast";
import AppShell, { View } from "@/components/AppShell";
import StatsBar from "@/components/StatsBar";
import PortalFilter from "@/components/PortalFilter";
import TenderCard from "@/components/TenderCard";
import PortalStatusPanel from "@/components/PortalStatusPanel";
import ScrapeProgressTable from "@/components/ScrapeProgressTable";
import SessionsPanel from "@/components/SessionsPanel";
import AlertsPanel from "@/components/AlertsPanel";
import Pagination from "@/components/Pagination";
import { SkeletonTenderList } from "@/components/Skeleton";
import { KEYWORD_CHIPS } from "@/lib/keywordChips";

const SEARCH_DEBOUNCE_MS = 350;

export default function HomePage() {
  const toast = useToast();
  const [tab, setTab] = useState<View>("search");

  const [portals, setPortals] = useState<PortalSummary[]>([]);
  const [portalsLoading, setPortalsLoading] = useState(true);
  const [portalsError, setPortalsError] = useState<string | null>(null);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [selectedPortals, setSelectedPortals] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedRelevance, setSelectedRelevance] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [results, setResults] = useState<TenderRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [page, setPage] = useState(1);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [runs, setRuns] = useState<any[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [scraping, setScraping] = useState<"all" | "new" | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // First load of each panel shows its own loading state; background polls
  // (see the effect below) update the same data silently so the page feels
  // live without flickering a spinner over content every few seconds.
  const loadPortals = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setPortalsLoading(true);
    setPortalsError(null);
    try {
      const res = await getPortals();
      setPortals(res.portals);
    } catch (err) {
      if (!opts.silent) setPortalsError(err instanceof ApiError ? err.message : "Unknown error");
    } finally {
      if (!opts.silent) setPortalsLoading(false);
    }
  }, []);

  const loadStats = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setStatsLoading(true);
    try {
      const res = await getStats();
      setStats(res);
    } catch {
      /* stats are supplementary -- a failure here shouldn't block the rest of the page */
    } finally {
      if (!opts.silent) setStatsLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setRunsLoading(true);
    if (!opts.silent) setRunsError(null);
    try {
      const res = await getScrapeRuns();
      setRuns(res.runs);
    } catch (err) {
      if (!opts.silent) setRunsError(err instanceof ApiError ? err.message : "Unknown error");
    } finally {
      if (!opts.silent) setRunsLoading(false);
    }
  }, []);

  // Debounce typing into the search box; Enter/the Search button flush this
  // immediately instead (see handleSearchNow) so an explicit request never
  // waits out the timer.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Cancels the previous in-flight search whenever a new one starts, so a
  // slow older request can never resolve after a newer one and overwrite
  // fresher results with stale ones.
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await searchTenders(
        {
          q: debouncedQuery || undefined,
          portals: selectedPortals.length ? selectedPortals : undefined,
          keywords: selectedKeywords.length ? selectedKeywords : undefined,
          relevance: selectedRelevance,
          page,
        },
        controller.signal
      );
      setResults(res.data);
      setTotal(res.totalMatching);
      setTotalPages(res.pagination.totalPages);
    } catch (err) {
      if (err instanceof ApiError && err.aborted) return; // superseded by a newer search
      setSearchError(err instanceof ApiError ? err.message : "Unknown error");
      setResults([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      if (abortRef.current === controller) setSearchLoading(false);
    }
  }, [debouncedQuery, selectedPortals, selectedKeywords, selectedRelevance, page]);

  const refreshAll = useCallback(
    (opts: { silent?: boolean } = {}) => {
      loadPortals(opts);
      loadStats(opts);
      loadRuns(opts);
      setLastUpdated(new Date());
    },
    [loadPortals, loadStats, loadRuns]
  );

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  // Live background refresh: portal status and scrape activity update on
  // their own every few seconds, same as the reference dashboard's polling
  // model, so a scrape someone else (or the scheduler) kicks off shows up
  // here without a manual reload.
  const pollingRef = useRef(refreshAll);
  pollingRef.current = refreshAll;
  useEffect(() => {
    const interval = setInterval(() => pollingRef.current({ silent: true }), 6000);
    return () => clearInterval(interval);
  }, []);

  function toggleKeyword(k: string) {
    setPage(1);
    setSelectedKeywords((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  /** Explicit Enter/Search-button path: skip the debounce timer entirely. */
  function handleSearchNow() {
    setPage(1);
    setDebouncedQuery(query);
  }

  async function handleScrapeAll(mode: "all" | "new") {
    setScraping(mode);
    try {
      const res = await triggerScrapeAll(mode);
      if (!res.accepted) {
        toast.info("A full sweep is already running — watch its progress under Activity.");
      } else {
        const busy = res.skipped.filter((s) => s.reason === "already-running").length;
        // Report what actually happened: a sweep that skipped half the
        // portals because the scheduler already has them is a normal
        // outcome, not a silent partial failure.
        toast.success(
          `Started ${res.started.length} portal${res.started.length === 1 ? "" : "s"}` +
            (busy > 0 ? ` — ${busy} already scraping` : "") +
            ". Progress appears under Activity."
        );
      }
      refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start scrape");
    } finally {
      setScraping(null);
    }
  }

  const enabledCount = portals.filter((p) => p.enabled).length;
  const gapToScrape = stats && stats.totalReported > stats.totalTenders ? stats.totalReported - stats.totalTenders : 0;
  const activeRuns = runs.filter((r) => r.status === "running").length;
  // The batch keeps running long after the trigger request returns, so the
  // button reflects real in-flight work (polled every 6s) rather than just
  // the brief moment the POST was in flight.
  const batchBusy = scraping !== null || activeRuns > 0;

  const subtitle = portalsLoading
    ? "Loading portals…"
    : portalsError
    ? "Portal status unavailable"
    : tab === "search"
    ? `Searching ${stats ? stats.totalTenders.toLocaleString("en-IN") : "—"} tenders across ${enabledCount} live portals`
    : tab === "portals"
    ? `${enabledCount} of ${portals.length} portals have a working scraper`
    : `${runs.length} recent run${runs.length === 1 ? "" : "s"}${activeRuns > 0 ? ` — ${activeRuns} in progress` : ""}`;

  return (
    <AppShell
      view={tab}
      onViewChange={setTab}
      navCounts={{ search: total, portals: enabledCount, activity: runs.length }}
      activeRuns={activeRuns}
      scrapingBatch={batchBusy}
      onScrapeAll={handleScrapeAll}
      lastUpdated={lastUpdated}
      subtitle={subtitle}
    >
      <StatsBar stats={stats} loading={statsLoading} />

      {gapToScrape > 0 && (
        <div className="banner">
          <RefreshCw size={16} />
          <span>
            Portals report <strong>{stats!.totalReported.toLocaleString("en-IN")}</strong> tenders total; you have{" "}
            <strong>{stats!.totalTenders.toLocaleString("en-IN")}</strong> stored — about{" "}
            <strong>{gapToScrape.toLocaleString("en-IN")}</strong> more available. Run a full sweep to catch up.
          </span>
        </div>
      )}

      {tab === "search" && (
        <>
          <div className="card">
            <div className="section-title">Search</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div className="search-field">
                <Search size={16} />
                <input
                  className="input"
                  placeholder="Search by bid number, thermal camera, LRF, NVG, department, state…"
                  value={query}
                  onChange={(e) => {
                    setPage(1);
                    setQuery(e.target.value);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSearchNow()}
                />
              </div>
              <button className="btn" onClick={handleSearchNow}>
                Search
              </button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div className="section-title">Keywords</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {KEYWORD_CHIPS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`chip ${selectedKeywords.includes(k) ? "active" : ""}`}
                    onClick={() => toggleKeyword(k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <PortalFilter
              portals={portals}
              selected={selectedPortals}
              onChange={(keys) => {
                setPage(1);
                setSelectedPortals(keys);
              }}
            />

            <div style={{ marginTop: 12 }}>
              <div className="section-title">Relevance</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  { id: undefined, label: "All" },
                  { id: "relevant", label: "Relevant" },
                  { id: "irrelevant", label: "Parts/Non-defence" },
                  { id: "unclassified", label: "Unclassified" },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    className={`chip ${selectedRelevance === opt.id ? "active" : ""}`}
                    onClick={() => {
                      setPage(1);
                      setSelectedRelevance(opt.id);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              Results {!searchLoading && !searchError && <span style={{ color: "var(--text-muted)" }}>({total.toLocaleString("en-IN")} matching)</span>}
            </div>
            {searchLoading && <SkeletonTenderList />}
            {!searchLoading && searchError && (
              <div className="error-state">
                Unable to load results — {searchError}{" "}
                <button className="btn small secondary" onClick={() => runSearch()}>
                  Retry
                </button>
              </div>
            )}
            {!searchLoading && !searchError && results.length === 0 && (
              <div className="empty-state">No tenders match your search yet.</div>
            )}
            {!searchLoading && !searchError && results.map((t) => <TenderCard key={t.id} tender={t} />)}
            {!searchLoading && !searchError && (
              <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
            )}
          </div>
        </>
      )}

      {tab === "portals" && (
        <PortalStatusPanel portals={portals} loading={portalsLoading} error={portalsError} onScrapeTriggered={refreshAll} />
      )}

      {tab === "activity" && (
        <div className="card">
          <div className="section-title">Recent scrape runs</div>
          <ScrapeProgressTable runs={runs} loading={runsLoading} error={runsError} />
        </div>
      )}

      {tab === "alerts" && <AlertsPanel />}

      {tab === "sessions" && <SessionsPanel />}
    </AppShell>
  );
}
