import { useEffect, useRef, useState } from "react";
import { Loader2, PlayCircle, CheckCircle2, XCircle, PauseCircle, HelpCircle, ExternalLink, Download, Ban } from "lucide-react";
import {
  PortalSummary,
  triggerScrapePortal,
  startAssistedSession,
  getAssistedSessionStatus,
  importAssistedSession,
  cancelAssistedSession,
  AssistedSessionStatus,
} from "@/lib/api";
import { useToast } from "@/lib/toast";

interface Props {
  portals: PortalSummary[];
  loading: boolean;
  error: string | null;
  onScrapeTriggered: () => void;
}

function statusBadge(p: PortalSummary) {
  if (!p.enabled && !p.supportsAssistedScrape) return <span className="badge muted"><PauseCircle size={12} />Disabled</span>;
  if (p.running) return <span className="badge warning"><Loader2 size={12} className="spin" />Running</span>;
  if (!p.lastRun) return <span className="badge muted"><HelpCircle size={12} />Never run</span>;
  if (p.lastRun.status === "success") return <span className="badge success"><CheckCircle2 size={12} />OK</span>;
  if (p.lastRun.status === "failed") return <span className="badge danger"><XCircle size={12} />Failed</span>;
  return <span className="badge muted">{p.lastRun.status}</span>;
}

function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

export default function PortalStatusPanel({ portals, loading, error, onScrapeTriggered }: Props) {
  const toast = useToast();
  const [assistedSessions, setAssistedSessions] = useState<Record<string, AssistedSessionStatus>>({});
  const [assistedBusy, setAssistedBusy] = useState<string | null>(null);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      Object.values(timers).forEach(clearInterval);
    };
  }, []);

  function pollSession(portalKey: string, sessionId: string) {
    if (pollTimers.current[portalKey]) clearInterval(pollTimers.current[portalKey]);
    pollTimers.current[portalKey] = setInterval(async () => {
      try {
        const status = await getAssistedSessionStatus(sessionId);
        setAssistedSessions((prev) => ({ ...prev, [portalKey]: status }));
      } catch {
        clearInterval(pollTimers.current[portalKey]);
        delete pollTimers.current[portalKey];
        setAssistedSessions((prev) => {
          const next = { ...prev };
          delete next[portalKey];
          return next;
        });
      }
    }, 3000);
  }

  async function handleScrape(key: string) {
    try {
      await triggerScrapePortal(key, "incremental");
      toast.success(`Scrape started for ${key}`);
      onScrapeTriggered();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start scrape");
    }
  }

  async function handleStartAssisted(key: string) {
    setAssistedBusy(key);
    try {
      const session = await startAssistedSession(key);
      const status = await getAssistedSessionStatus(session.sessionId);
      setAssistedSessions((prev) => ({ ...prev, [key]: status }));
      pollSession(key, session.sessionId);
      toast.info("Browser window opened — solve the CAPTCHA there, then come back and click Import Pages.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open assisted session");
    } finally {
      setAssistedBusy(null);
    }
  }

  async function handleImportAssisted(key: string) {
    const session = assistedSessions[key];
    if (!session) return;
    setAssistedBusy(key);
    try {
      const result = await importAssistedSession(session.sessionId);
      clearInterval(pollTimers.current[key]);
      delete pollTimers.current[key];
      setAssistedSessions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.success(`Imported ${result.found} tender(s) from ${result.pagesScanned} page(s).`);
      onScrapeTriggered();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import visible tenders");
    } finally {
      setAssistedBusy(null);
    }
  }

  async function handleCancelAssisted(key: string) {
    const session = assistedSessions[key];
    if (!session) return;
    setAssistedBusy(key);
    try {
      await cancelAssistedSession(session.sessionId);
    } catch {
      /* ignore -- clearing local state regardless */
    } finally {
      clearInterval(pollTimers.current[key]);
      delete pollTimers.current[key];
      setAssistedSessions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setAssistedBusy(null);
    }
  }

  if (loading) return <div className="loading-state">Loading portal status…</div>;
  if (error) return <div className="error-state">Unable to load portal status — {error}</div>;
  if (portals.length === 0) return <div className="empty-state">No portals configured.</div>;

  return (
    <div className="portal-grid">
      {portals.map((p) => {
        const stated = p.lastRun?.statedTotal;
        const gap = stated != null && stated > p.tenderCount ? stated - p.tenderCount : 0;
        // Only meaningful when the portal reports its own total; otherwise
        // there's nothing to measure coverage against.
        const coverage = stated != null && stated > 0 ? Math.min(100, (p.tenderCount / stated) * 100) : null;
        const session = assistedSessions[p.key];
        const busy = assistedBusy === p.key;
        const failed = p.lastRun?.status === "failed";

        return (
          <div className={`portal-card ${p.running ? "running" : ""} ${failed ? "failed" : ""}`} key={p.key}>
            <div className="portal-card-head">
              <h3 title={p.name}>{p.name}</h3>
              {statusBadge(p)}
            </div>

            <div className="portal-card-metric">
              <span className="metric-value">{fmt(p.tenderCount)}</span>
              <span className="metric-label">tenders stored</span>
            </div>

            {coverage !== null ? (
              <div className="coverage">
                <div className="coverage-bar">
                  <div
                    className={`coverage-fill ${gap > 0 ? "partial" : "complete"}`}
                    style={{ width: `${coverage}%` }}
                  />
                </div>
                <div className="coverage-legend">
                  <span>{coverage.toFixed(0)}% of {fmt(stated!)} reported</span>
                  {gap > 0 && <span className="coverage-gap">{fmt(gap)} to go</span>}
                </div>
              </div>
            ) : (
              <div className="coverage-none">Portal does not report a total</div>
            )}

            <dl className="portal-card-facts">
              <div>
                <dt>Scraper</dt>
                <dd>
                  {p.enabled && p.supportsAssistedScrape
                    ? "Automatic + Assisted"
                    : p.enabled
                    ? "Automatic"
                    : p.supportsAssistedScrape
                    ? "Assisted only"
                    : "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Last success</dt>
                <dd>
                  {p.lastSuccessfulScrapeAt
                    ? new Date(p.lastSuccessfulScrapeAt).toLocaleString([], {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Never"}
                </dd>
              </div>
            </dl>

            {failed && p.lastRun?.errorMessage && (
              <p className="portal-card-error" title={p.lastRun.errorMessage}>
                {p.lastRun.errorMessage}
              </p>
            )}

            <div className="portal-card-actions">
              {p.enabled && (
                <button className="btn small secondary" disabled={p.running} onClick={() => handleScrape(p.key)}>
                  {p.running ? <Loader2 size={12} className="spin" /> : <PlayCircle size={12} />}
                  Scrape
                </button>
              )}

              {p.supportsAssistedScrape && session && (
                <>
                  <button className="btn small" disabled={busy} onClick={() => handleImportAssisted(p.key)}>
                    {busy ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
                    Import Pages
                  </button>
                  <button className="btn small secondary" disabled={busy} onClick={() => handleCancelAssisted(p.key)}>
                    <Ban size={12} />
                    Cancel
                  </button>
                  <span className="assisted-hint">
                    {session.captchaVisible ? "CAPTCHA shown" : `${session.detectedTenders} rows visible`}
                  </span>
                </>
              )}

              {p.supportsAssistedScrape && !session && (
                <button className="btn small secondary" disabled={busy} onClick={() => handleStartAssisted(p.key)}>
                  {busy ? <Loader2 size={12} className="spin" /> : <ExternalLink size={12} />}
                  {p.enabled ? "Deep Scrape" : "Open CAPTCHA"}
                </button>
              )}

              {!p.enabled && !p.supportsAssistedScrape && <span className="assisted-hint">No adapter</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
