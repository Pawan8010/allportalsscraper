"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  CalendarClock,
  CalendarDays,
  Database,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";

type Tender = {
  id: string;
  tenderId: string;
  portal: string;
  title: string;
  organisation?: string | null;
  department?: string | null;
  location?: string | null;
  state?: string | null;
  category?: string | null;
  keywordMatched?: string | null;
  tenderStatus: string;
  tenderURL: string;
  publishedDate?: string | null;
  closingDate?: string | null;
  createdAt: string;
};

type PortalStatus = {
  key: string;
  name: string;
  shortName: string;
  family: "GEM" | "GEPNIC" | "CUSTOM" | "INFORMATIONAL";
  enabled: boolean;
  supportsAssistedScrape?: boolean;
  storedTenders: number;
  latestRun?: {
    status: string;
    startedAt: string;
    statedTotal?: number | null;
  } | null;
};

type SearchResponse = {
  data: Tender[];
  total: number;
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
  source?: string;
  searchedAt?: string;
  meta?: {
    normalizedQuery?: string | null;
    keywords?: string[];
    live?: {
      state?: string;
      gemStatedTotal?: number | null;
      syncedAt?: string | null;
    };
  };
};

type Stats = {
  totalTenders: number;
  gemListedTotal: number;
  newToday: number;
  closingSoon: number;
  keywordMatches: number;
  duplicateOrUnmappedListings: number;
  lastScrapeAt: string | null;
  lastScrapeStatus: string | null;
};

type ScrapeProgress = {
  runId: string;
  status: string;
  mode: string;
  pagesScanned: number;
  tendersFound: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  gemStatedTotal: number | null;
  startedAt: string;
  finishedAt: string | null;
  inProgress: boolean;
  message?: string | null;
};

type AssistedSession = {
  sessionId: string;
  portalKey: string;
  portal: string;
  expiresAt: string;
};

type AllPortalJob = {
  id: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  mode: "FULL" | "NEW";
  totalPortals: number;
  completedPortals: number;
  currentPortal: string | null;
  successfulPortals: string[];
  failedPortals: Array<{ portal: string; error: string }>;
};

const API_BASES = unique([
  "/backend-api",
  process.env.NEXT_PUBLIC_API_URL,
  "http://127.0.0.1:4000/api",
  "http://localhost:4000/api",
]);

/** How long any single API call may hang before we surface a retryable error. */
const REQUEST_TIMEOUT_MS = 30000;
/** Search-as-you-type delay. */
const SEARCH_DEBOUNCE_MS = 350;
const PAGE_SIZE = 50;

const KEYWORDS = [
  "Weapon Sight",
  "Thermal Camera",
  "Thermal Weapon Sight",
  "Thermal Imager",
  "Thermal Imaging Sight",
  "Handheld Thermal Imager",
  "Uncooled Thermal",
  "Cooled Thermal",
  "Night Vision Sight",
  "Day Night Sight",
  "Night Vision Device",
  "Night Vision Device (NVD)",
  "Night Vision Goggles",
  "Night Vision Goggles (NVG)",
  "Image Intensifier",
  "Laser Range Finder",
  "Laser Range Finder (LRF) integrated sight",
  "LOROS",
  "Long Range Observation System (LOROS)",
  "EOSS",
  "Electro Optical Surveillance System (EOSS)",
  "Battlefield Surveillance Radar",
  "Battlefield Surveillance Radar + EO",
  "Border Surveillance System",
  "Pan Tilt Zoom Camera",
  "PTZ with EO payload",
  "Pan Tilt Zoom Camera (PTZ with EO payload)",
  "Long Range PTZ Camera",
  "Longe range PTZ Camera",
  "PTZ Camera",
  "Optical Camera",
  "Night Vision Camera",
  "Reflex Sight",
  "Red Dot Sight",
  "Holographic Sight",
  "LWIR",
  "MWIR",
  "LWIR / MWIR",
  "Target Acquisition System",
  "Night vision Camera",
];

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function dateLabel(value?: string | null) {
  if (!value) return "Not listed";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not listed";
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function relativeLabel(value?: string | null) {
  if (!value) return "never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "never";
  const seconds = Math.round((Date.now() - parsed.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const [results, setResults] = useState<SearchResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [portals, setPortals] = useState<PortalStatus[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null);
  const [allPortalJob, setAllPortalJob] = useState<AllPortalJob | null>(null);
  const [scrapeStarting, setScrapeStarting] = useState(false);
  const [assistedSessions, setAssistedSessions] = useState<Record<string, AssistedSession>>({});
  const [assistedBusy, setAssistedBusy] = useState<string | null>(null);

  // Bumped by the retry button to force a reload of the current query.
  const [reloadToken, setReloadToken] = useState(0);
  const pollTimer = useRef<number | null>(null);
  const allPortalPollTimer = useRef<number | null>(null);
  const assistedPollTimers = useRef<Record<string, number>>({});

  const searchPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    params.set("sort", "relevance");
    if (debouncedQuery) params.set("q", debouncedQuery);
    // Repeated `keywords` params - the API ORs them together.
    for (const keyword of selectedKeywords) params.append("keywords", keyword);
    return `/tenders/search?${params.toString()}`;
  }, [debouncedQuery, selectedKeywords, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  /**
   * Tries every configured API base in turn. `NEXT_PUBLIC_API_URL` comes first;
   * 127.0.0.1 and localhost are both attempted because a browser treats them as
   * different origins even though they are the same dev server.
   */
  const apiFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    // Every base failed for the same underlying reason -> report it once, with
    // something the reader can act on. A bare "Failed to fetch" says nothing
    // about which URL was tried or what to check.
    let lastError: Error | null = null;
    let sawNetworkFailure = false;

    for (const base of API_BASES) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`${base}${path}`, {
          cache: "no-store",
          signal: controller.signal,
          ...init,
        });
        if (response.ok) return response;

        // Prefer the backend's own error message over a bare status code.
        let detail = `HTTP ${response.status} ${response.statusText}`.trim();
        try {
          const body = await response.json();
          if (body?.error) detail = String(body.error);
        } catch {
          /* non-JSON error body */
        }
        lastError = new Error(`${base}${path} -> ${detail}`);
      } catch (err) {
        const error = err as Error;
        if (error?.name === "AbortError") {
          lastError = new Error(`${base} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`);
        } else {
          // fetch() rejects with an opaque TypeError ("Failed to fetch") for
          // connection refused, DNS failure and CORS rejection alike.
          sawNetworkFailure = true;
          lastError = error;
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    if (sawNetworkFailure) {
      throw new Error(
        `Cannot reach the backend API. Tried ${API_BASES.join(" and ")}. ` +
          `Check that it is running on port 4000 (npm run dev in backend/), that NEXT_PUBLIC_API_URL is correct, ` +
          `and that this origin is listed in the backend's CORS_ORIGIN.`
      );
    }

    throw lastError ?? new Error(`Cannot reach the API. Tried: ${API_BASES.join(", ")}`);
  }, []);

  const loadStats = useCallback(async () => {
    const response = await apiFetch("/tenders/stats");
    setStats(await response.json());
  }, [apiFetch]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [searchRes, statsRes, portalsRes] = await Promise.all([
        apiFetch(searchPath),
        apiFetch("/tenders/stats"),
        apiFetch("/portals"),
      ]);
      setResults(await searchRes.json());
      setStats(await statsRes.json());
      const portalBody = await portalsRes.json();
      setPortals(portalBody.data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load data from the API");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, searchPath]);

  useEffect(() => {
    void loadData();
  }, [loadData, reloadToken]);

  /** Polls one scrape run until it finishes, refreshing counts as it goes. */
  const pollScrape = useCallback(
    async (runId: string) => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      if (allPortalPollTimer.current) window.clearTimeout(allPortalPollTimer.current);

      try {
        const response = await apiFetch(`/scrape/status/${runId}`);
        const progress = (await response.json()) as ScrapeProgress;
        setScrapeProgress(progress);
        await loadStats().catch(() => undefined);

        if (progress.inProgress) {
          pollTimer.current = window.setTimeout(() => void pollScrape(runId), 2000);
          return;
        }

        setNotice(
          progress.status === "SUCCESS"
            ? `${progress.mode === "NEW" ? "New tender scrape" : "Full scrape"} finished: ${progress.pagesScanned} pages scanned, ${progress.inserted} inserted, ${progress.updated} updated, ${progress.skipped} skipped.`
            : `Scrape finished as ${progress.status}: ${progress.errors} page error(s). ${progress.message ?? ""}`.trim()
        );
        // Newly stored bids should show up in the current search.
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Lost track of the scrape run");
      }
    },
    [apiFetch, loadStats, loadData]
  );

  useEffect(() => {
    // Reattach to a scrape that is already running (e.g. after a page reload).
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch("/scrape/status");
        const body = await response.json();
        if (cancelled) return;
        if (body?.inProgress && body?.runId) void pollScrape(body.runId);
        else if (body?.latestRun) setScrapeProgress(body.latestRun);
      } catch {
        /* the search error surface already reports connectivity problems */
      }
    })();
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      for (const timer of Object.values(assistedPollTimers.current)) window.clearInterval(timer);
      assistedPollTimers.current = {};
    };
  }, [apiFetch, pollScrape]);

  async function startScrape(kind: "all" | "new") {
    setScrapeStarting(true);
    setError(null);
    setNotice(
      kind === "all"
        ? "Starting a full sweep of every enabled automatic tender portal."
        : "Checking every enabled automatic portal for newly published and changed tenders."
    );
    try {
      const response = await apiFetch("/portals/scrape-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: kind === "all" ? "FULL" : "NEW" }),
      });
      const body = await response.json();
      if (!body?.id) throw new Error("The API did not return an all-portal job id");
      setAllPortalJob(body);
      const pollAllPortals = async () => {
        const statusResponse = await apiFetch(`/portals/scrape-all/${body.id}`);
        const job = (await statusResponse.json()) as AllPortalJob;
        setAllPortalJob(job);
        setNotice(
          job.status === "RUNNING"
            ? `Scraping all portals: ${job.completedPortals}/${job.totalPortals} complete${job.currentPortal ? `; working on ${job.currentPortal}` : ""}.`
            : `All-portal scrape finished as ${job.status}: ${job.successfulPortals.length} succeeded, ${job.failedPortals.length} failed.`
        );
        if (job.status === "RUNNING") {
          allPortalPollTimer.current = window.setTimeout(() => void pollAllPortals(), 2_000);
        } else {
          allPortalPollTimer.current = null;
          await loadData();
        }
      };
      void pollAllPortals();
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : "Could not start the scrape");
    } finally {
      setScrapeStarting(false);
    }
  }

  async function startAssisted(portal: PortalStatus) {
    setAssistedBusy(portal.key);
    setError(null);
    try {
      const response = await apiFetch(`/portals/${portal.key}/assisted/start`, { method: "POST" });
      const body = await response.json();
      setAssistedSessions((current) => ({
        ...current,
        [portal.key]: {
          sessionId: body.sessionId,
          portalKey: portal.key,
          portal: body.portal,
          expiresAt: body.expiresAt,
        },
      }));
      setNotice(
        body.reused
          ? `${portal.name}: reconnected to the existing assisted browser session. Solve the CAPTCHA and remain on the tender results page.`
          : `${portal.name} opened in a separate browser. Solve the CAPTCHA and remain on the tender results page. Import starts after the result list is stable.`
      );
      const sessionId = String(body.sessionId);
      const monitor = async () => {
        try {
          const statusResponse = await apiFetch(`/portals/assisted/${sessionId}/status`);
          const status = await statusResponse.json();
          if (status.ready) {
            window.clearInterval(assistedPollTimers.current[portal.key]);
            delete assistedPollTimers.current[portal.key];
            const importResponse = await apiFetch(`/portals/assisted/${sessionId}/import`, { method: "POST" });
            const result = await importResponse.json();
            setAssistedSessions((current) => {
              const next = { ...current };
              delete next[portal.key];
              return next;
            });
            setNotice(
              `${portal.name}: imported ${result.found.toLocaleString("en-IN")} tenders from ${result.pagesScanned.toLocaleString("en-IN")} page(s). The assisted portal window will remain open briefly for verification.`
            );
            await loadData();
          }
        } catch (err) {
          setError(
            err instanceof Error
              ? `${portal.name} status check failed; automatic polling will retry. ${err.message}`
              : `${portal.name} status check failed; automatic polling will retry.`
          );
        }
      };
      assistedPollTimers.current[portal.key] = window.setInterval(() => void monitor(), 2000);
      void monitor();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not open ${portal.name}`);
    } finally {
      setAssistedBusy(null);
    }
  }

  async function importAssisted(portal: PortalStatus) {
    const session = assistedSessions[portal.key];
    if (!session) return;
    setAssistedBusy(portal.key);
    setError(null);
    try {
      const response = await apiFetch(`/portals/assisted/${session.sessionId}/import`, { method: "POST" });
      const result = await response.json();
      setAssistedSessions((current) => {
        const next = { ...current };
        delete next[portal.key];
        return next;
      });
      setNotice(
        `${portal.name}: imported ${result.found.toLocaleString("en-IN")} tenders from ${result.pagesScanned.toLocaleString("en-IN")} page(s); ${result.inserted.toLocaleString("en-IN")} inserted and ${result.updated.toLocaleString("en-IN")} updated.`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not import ${portal.name}`);
    } finally {
      setAssistedBusy(null);
    }
  }

  async function cancelAssisted(portal: PortalStatus) {
    const session = assistedSessions[portal.key];
    if (!session) return;
    setAssistedBusy(portal.key);
    try {
      if (assistedPollTimers.current[portal.key]) {
        window.clearInterval(assistedPollTimers.current[portal.key]);
        delete assistedPollTimers.current[portal.key];
      }
      await apiFetch(`/portals/assisted/${session.sessionId}`, { method: "DELETE" });
      setAssistedSessions((current) => {
        const next = { ...current };
        delete next[portal.key];
        return next;
      });
      setNotice(`${portal.name} assisted session closed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not close ${portal.name}`);
    } finally {
      setAssistedBusy(null);
    }
  }

  function toggleKeyword(item: string) {
    setSelectedKeywords((current) =>
      current.includes(item) ? current.filter((keyword) => keyword !== item) : [...current, item]
    );
    setPage(1);
  }

  function clearAll() {
    setQuery("");
    setDebouncedQuery("");
    setSelectedKeywords([]);
    setPage(1);
  }

  const scraping =
    scrapeStarting ||
    Boolean(scrapeProgress?.inProgress) ||
    allPortalJob?.status === "RUNNING";
  const totalResults = results?.total ?? 0;
  const hasSearchTerms = Boolean(debouncedQuery) || selectedKeywords.length > 0;

  return (
    <main style={{ minHeight: "100vh", padding: "32px 20px" }}>
      <section style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header style={panelStyle}>
          <div>
            <div style={eyebrowStyle}>
              <ShieldCheck size={16} /> All Government Tender Portals
            </div>
            <h1 style={{ fontSize: 48, lineHeight: 1, margin: "12px 0" }}>RRP Groups Tender Search</h1>
            <p style={{ color: "#a8b3c7", maxWidth: 760 }}>
              Scrapes public tenders from every enabled procurement portal, stores records in PostgreSQL via Prisma, and shows searchable ranked results for RRP Groups.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => void startScrape("all")} disabled={scraping} style={primaryButtonStyle}>
              {scraping ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
              Scrape All Portals
            </button>
            <button onClick={() => void startScrape("new")} disabled={scraping} style={secondaryButtonStyle}>
              Scrape New Tenders From All
            </button>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>
              Last scrape: {relativeLabel(stats?.lastScrapeAt)}
              {stats?.lastScrapeStatus ? ` (${stats.lastScrapeStatus})` : ""}
            </span>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 16, margin: "24px 0" }}>
          <Stat title="Stored Tenders" value={stats?.totalTenders ?? 0} icon={<Database size={20} />} />
          <Stat title="GeM Listed" value={stats?.gemListedTotal ?? 0} icon={<ShieldCheck size={20} />} />
          <Stat title="New Today" value={stats?.newToday ?? 0} icon={<RefreshCw size={20} />} />
          <Stat title="Closing Soon" value={stats?.closingSoon ?? 0} icon={<CalendarDays size={20} />} />
          <Stat title="Keyword Matches" value={stats?.keywordMatches ?? 0} icon={<Search size={20} />} />
        </section>
        <section style={{ ...panelStyle, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 24 }}>Tender Count by Portal</h2>
              <p style={{ color: "#94a3b8", margin: "6px 0 0" }}>
                Stored PostgreSQL records and the latest total reported by each procurement portal.
              </p>
            </div>
            <strong style={{ color: "#67e8f9", whiteSpace: "nowrap" }}>
              {portals
                .filter((portal) => portal.family !== "INFORMATIONAL")
                .reduce((total, portal) => total + portal.storedTenders, 0)
                .toLocaleString("en-IN")}{" "}
              stored
            </strong>
          </div>
          <div style={{ overflowX: "auto", border: "1px solid #25324a", borderRadius: 16 }}>
            <table style={{ width: "100%", minWidth: 780, borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#0b1427", color: "#94a3b8", fontSize: 12, textTransform: "uppercase" }}>
                  <th style={portalTableCellStyle}>Portal</th>
                  <th style={portalTableCellStyle}>Scraper</th>
                  <th style={portalTableCellStyle}>Stored</th>
                  <th style={portalTableCellStyle}>Portal Reported</th>
                  <th style={portalTableCellStyle}>Latest Status</th>
                  <th style={portalTableCellStyle}>Last Scraped</th>
                  <th style={portalTableCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {portals
                  .filter((portal) => portal.family !== "INFORMATIONAL")
                  .map((portal) => (
                    <tr key={portal.key} style={{ borderTop: "1px solid #1d2940" }}>
                      <td style={portalTableCellStyle}>
                        <strong>{portal.name}</strong>
                        <div style={{ color: "#64748b", fontSize: 12 }}>{portal.shortName}</div>
                      </td>
                      <td style={portalTableCellStyle}>
                        {portal.enabled ? "Automatic" : portal.supportsAssistedScrape ? "Assisted" : "Unavailable"}
                      </td>
                      <td style={{ ...portalTableCellStyle, color: "#67e8f9", fontWeight: 800 }}>
                        {portal.storedTenders.toLocaleString("en-IN")}
                      </td>
                      <td style={portalTableCellStyle}>
                        {portal.latestRun?.statedTotal != null
                          ? portal.latestRun.statedTotal.toLocaleString("en-IN")
                          : "Not reported"}
                      </td>
                      <td style={portalTableCellStyle}>{portal.latestRun?.status ?? "Not run"}</td>
                      <td style={portalTableCellStyle}>{relativeLabel(portal.latestRun?.startedAt)}</td>
                      <td style={portalTableCellStyle}>
                        {portal.supportsAssistedScrape && !portal.enabled ? (
                          assistedSessions[portal.key] ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                onClick={() => void importAssisted(portal)}
                                disabled={assistedBusy === portal.key}
                                style={smallPrimaryButtonStyle}
                              >
                                {assistedBusy === portal.key ? <Loader2 className="spin" size={14} /> : null}
                                Import Pages
                              </button>
                              <button
                                onClick={() => void cancelAssisted(portal)}
                                disabled={assistedBusy === portal.key}
                                style={smallSecondaryButtonStyle}
                              >
                                Cancel
                              </button>
                              <span style={{ color: "#94a3b8", fontSize: 11 }}>
                                expires {dateLabel(assistedSessions[portal.key].expiresAt)}
                              </span>
                            </div>
                          ) : (
                            <button
                              onClick={() => void startAssisted(portal)}
                              disabled={assistedBusy === portal.key}
                              style={smallSecondaryButtonStyle}
                            >
                              {assistedBusy === portal.key ? <Loader2 className="spin" size={14} /> : <ExternalLink size={14} />}
                              Open / Resume CAPTCHA
                            </button>
                          )
                        ) : portal.enabled ? (
                          <span style={{ color: "#67e8f9", fontSize: 12 }}>Included automatically</span>
                        ) : (
                          <span style={{ color: "#64748b", fontSize: 12 }}>No adapter</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        {stats != null && stats.gemListedTotal > stats.totalTenders && (
          <p style={{ color: "#94a3b8", margin: "-12px 0 20px" }}>
            GeM currently lists {stats.gemListedTotal.toLocaleString("en-IN")} ongoing bids; PostgreSQL holds{" "}
            {stats.totalTenders.toLocaleString("en-IN")} unique bid numbers so far. Run “Scrape All Portals” to refresh every enabled source.
          </p>
        )}

        <section style={panelStyle}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={20} style={{ position: "absolute", left: 16, top: 15, color: "#64748b" }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by bid number, thermal camera, LRF, NVG, department, state..."
                style={inputStyle}
              />
            </div>
            {(query || selectedKeywords.length > 0) && (
              <button onClick={clearAll} style={secondaryButtonStyle}>
                Clear Selected Keywords
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            {KEYWORDS.map((item) => (
              <button
                key={item}
                onClick={() => toggleKeyword(item)}
                style={selectedKeywords.includes(item) ? activeChipStyle : chipStyle}
              >
                {item}
              </button>
            ))}
          </div>
          {selectedKeywords.length > 0 && (
            <div style={{ marginTop: 14, color: "#94a3b8", fontSize: 13 }}>
              Matching any of: <span style={{ color: "#67e8f9" }}>{selectedKeywords.join(" / ")}</span>
              {debouncedQuery && (
                <>
                  {" "}and also matching <span style={{ color: "#67e8f9" }}>{debouncedQuery}</span>
                </>
              )}
            </div>
          )}
        </section>

        {error && (
          <div style={{ ...panelStyle, borderColor: "#ef4444", marginTop: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <AlertCircle size={18} color="#f87171" />
            <span style={{ flex: 1, minWidth: 240 }}>{error}</span>
            <button onClick={() => setReloadToken((token) => token + 1)} style={primaryButtonStyle}>
              <RefreshCw size={16} /> Retry
            </button>
          </div>
        )}

        {notice && !error && (
          <div style={{ ...panelStyle, borderColor: "#164e63", marginTop: 20, display: "flex", alignItems: "center", gap: 10 }}>
            <AlertCircle size={18} /> {notice}
          </div>
        )}

        {scrapeProgress && (
          <div style={{ ...panelStyle, marginTop: 20, borderColor: scrapeProgress.inProgress ? "#164e63" : "rgba(148, 163, 184, 0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              {scrapeProgress.inProgress ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
              <strong>
                {scrapeProgress.mode === "NEW" ? "New tender scrape" : "Full GeM scrape"} - {scrapeProgress.status}
              </strong>
              <span style={{ color: "#94a3b8", fontSize: 13 }}>started {relativeLabel(scrapeProgress.startedAt)}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={metaStyle}>Pages scanned: {scrapeProgress.pagesScanned.toLocaleString("en-IN")}</span>
              <span style={metaStyle}>Found: {scrapeProgress.tendersFound.toLocaleString("en-IN")}</span>
              <span style={metaStyle}>Inserted: {scrapeProgress.inserted.toLocaleString("en-IN")}</span>
              <span style={metaStyle}>Updated: {scrapeProgress.updated.toLocaleString("en-IN")}</span>
              <span style={metaStyle}>Skipped: {scrapeProgress.skipped.toLocaleString("en-IN")}</span>
              <span style={metaStyle}>Errors: {scrapeProgress.errors.toLocaleString("en-IN")}</span>
              {scrapeProgress.gemStatedTotal !== null && (
                <span style={metaStyle}>GeM reports: {scrapeProgress.gemStatedTotal.toLocaleString("en-IN")} bids</span>
              )}
            </div>
          </div>
        )}

        <section style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 24, marginBottom: 6 }}>Tender Results</h2>
              <p style={{ color: "#94a3b8", marginTop: 0 }}>
                {loading
                  ? "Searching stored GeM tenders..."
                  : `${totalResults.toLocaleString("en-IN")} matching tender${totalResults === 1 ? "" : "s"}${hasSearchTerms ? "" : " stored in PostgreSQL"}`}
              </p>
              {results?.meta?.live?.gemStatedTotal != null && (
                <p style={{ color: "#67e8f9", marginTop: -4, fontSize: 13 }}>
                  All stored portals were searched. GeM live sync additionally reports {results.meta.live.gemStatedTotal.toLocaleString("en-IN")} bids for these terms
                  {results.meta.live.syncedAt ? ` (synced ${relativeLabel(results.meta.live.syncedAt)})` : ""}.
                </p>
              )}
            </div>
          </div>

          {loading ? (
            <div style={emptyStyle}>
              <Loader2 className="spin" /> Loading tenders...
            </div>
          ) : error ? (
            <div style={emptyStyle}>Could not load results. Use Retry above.</div>
          ) : !results?.data.length ? (
            <div style={emptyStyle}>
              No results found{hasSearchTerms ? ` for ${debouncedQuery || selectedKeywords.join(" / ")}` : ""}.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {results.data.map((tender) => (
                <article key={tender.id} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
                    <div>
                      <div style={{ color: "#67e8f9", fontFamily: "monospace", fontWeight: 700 }}>{tender.tenderId}</div>
                      <h3 style={{ margin: "8px 0", fontSize: 20 }}>{tender.title}</h3>
                      <p style={{ color: "#94a3b8", margin: 0, display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <Building2 size={14} /> {tender.organisation || "Organisation not listed"}
                        </span>
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <ShieldCheck size={14} /> {tender.department || "Department not listed"}
                        </span>
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <MapPin size={14} /> {[tender.location, tender.state].filter(Boolean).join(", ") || "Location not listed"}
                        </span>
                      </p>
                    </div>
                    <a href={tender.tenderURL} target="_blank" rel="noreferrer" style={linkButtonStyle}>
                      Open {tender.portal || "Source"} Portal <ExternalLink size={16} />
                    </a>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                    <span style={{ ...metaStyle, color: "#67e8f9" }}>Source: {tender.portal || "Unknown portal"}</span>
                    <span style={metaStyle}>Status: {tender.tenderStatus}</span>
                    <span style={metaStyle}>
                      <CalendarDays size={12} style={{ verticalAlign: "-2px" }} /> Published: {dateLabel(tender.publishedDate)}
                    </span>
                    <span style={metaStyle}>
                      <CalendarClock size={12} style={{ verticalAlign: "-2px" }} /> Closes: {dateLabel(tender.closingDate)}
                    </span>
                    {tender.keywordMatched && <span style={metaStyle}>Matched: {tender.keywordMatched}</span>}
                  </div>
                </article>
              ))}
            </div>
          )}

          {results && results.pagination.totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={secondaryButtonStyle}>
                Previous
              </button>
              <span style={{ color: "#94a3b8" }}>
                Page {page} of {results.pagination.totalPages.toLocaleString("en-IN")}
              </span>
              <button
                disabled={page >= results.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={secondaryButtonStyle}
              >
                Next
              </button>
            </div>
          )}
        </section>
      </section>
      <style jsx global>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
}

function Stat({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <div style={statStyle}>
      <div style={{ color: "#67e8f9" }}>{icon}</div>
      <div style={{ color: "#94a3b8", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5 }}>{title}</div>
      <div style={{ fontSize: 34, fontWeight: 900 }}>{value.toLocaleString("en-IN")}</div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.2)",
  background: "rgba(15, 23, 42, 0.76)",
  borderRadius: 24,
  padding: 24,
  boxShadow: "0 24px 80px rgba(0,0,0,.25)",
};

const statStyle: React.CSSProperties = { ...panelStyle, padding: 18 };
const eyebrowStyle: React.CSSProperties = { display: "inline-flex", gap: 8, alignItems: "center", color: "#67e8f9", fontSize: 12, fontWeight: 800, letterSpacing: 3 };
const primaryButtonStyle: React.CSSProperties = { display: "inline-flex", gap: 10, alignItems: "center", border: 0, borderRadius: 16, padding: "14px 18px", background: "#22d3ee", color: "#03101a", fontWeight: 900, cursor: "pointer" };
const secondaryButtonStyle: React.CSSProperties = { border: "1px solid rgba(148, 163, 184, 0.25)", borderRadius: 14, padding: "12px 16px", background: "rgba(15, 23, 42, .8)", color: "#e2e8f0", cursor: "pointer" };
const inputStyle: React.CSSProperties = { width: "100%", border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: 16, background: "rgba(2, 6, 23, .55)", color: "#e2e8f0", padding: "14px 16px 14px 48px", outline: "none" };
const chipStyle: React.CSSProperties = { border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: 999, padding: "8px 12px", background: "rgba(2, 6, 23, .55)", color: "#cbd5e1", cursor: "pointer" };
const activeChipStyle: React.CSSProperties = { ...chipStyle, background: "#22d3ee", color: "#03101a", fontWeight: 800 };
const cardStyle: React.CSSProperties = { ...panelStyle, padding: 20 };
const emptyStyle: React.CSSProperties = { ...panelStyle, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#94a3b8", minHeight: 140 };
const linkButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  gap: 8,
  alignItems: "center",
  justifyContent: "center",
  textDecoration: "none",
  height: 46,
  minWidth: 142,
  whiteSpace: "nowrap",
  flexShrink: 0,
};
const metaStyle: React.CSSProperties = { borderRadius: 12, padding: "8px 10px", background: "rgba(2, 6, 23, .65)", color: "#cbd5e1", fontSize: 13 };
const portalTableCellStyle: React.CSSProperties = { padding: "13px 14px", color: "#cbd5e1", verticalAlign: "middle" };
const smallPrimaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  padding: "8px 10px",
  borderRadius: 10,
  fontSize: 12,
};
const smallSecondaryButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px",
  borderRadius: 10,
  fontSize: 12,
};
