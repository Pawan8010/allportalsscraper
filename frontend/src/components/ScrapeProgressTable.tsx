import { Loader2, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from "lucide-react";

interface Run {
  id: string;
  portal: string;
  mode: string;
  status: string;
  pagesScanned: number;
  tendersFound: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  statedTotal?: number | null;
  errorMessage?: string | null;
  startedAt: string;
  finishedAt: string | null;
}

function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

/** "just now" / "4m ago" / "2h ago" -- a run log is read relatively far more often than absolutely. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function duration(run: Run): string {
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  const secs = Math.max(0, Math.round((end - new Date(run.startedAt).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function statusBadge(status: string) {
  if (status === "success") return <span className="badge success"><CheckCircle2 size={12} />success</span>;
  if (status === "failed") return <span className="badge danger"><XCircle size={12} />failed</span>;
  if (status === "running") return <span className="badge warning"><Loader2 size={12} className="spin" />running</span>;
  if (status === "partial") return <span className="badge warning"><AlertTriangle size={12} />partial</span>;
  if (status === "skipped") return <span className="badge muted"><MinusCircle size={12} />skipped</span>;
  return <span className="badge muted">{status}</span>;
}

export default function ScrapeProgressTable({ runs, loading, error }: { runs: Run[]; loading: boolean; error: string | null }) {
  if (loading) return <div className="loading-state">Loading scrape runs…</div>;
  if (error) return <div className="error-state">Unable to load scrape runs — {error}</div>;
  if (runs.length === 0) return <div className="empty-state">No scrape runs yet. Start one from the sidebar.</div>;

  return (
    <div className="table-wrap">
      <table className="run-table">
        <thead>
          <tr>
            <th>Portal</th>
            <th>Status</th>
            <th className="num">Found</th>
            <th>Breakdown</th>
            <th className="num">Pages</th>
            <th>Duration</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className={r.status === "running" ? "row-running" : ""}>
              <td>
                <span className="run-portal">{r.portal}</span>
                <span className="run-mode">{r.mode}</span>
              </td>
              <td>
                {statusBadge(r.status)}
                {r.status === "failed" && r.errorMessage && (
                  <div className="run-error" title={r.errorMessage}>
                    {r.errorMessage}
                  </div>
                )}
              </td>
              <td className="num strong">{fmt(r.tendersFound)}</td>
              <td>
                <div className="run-breakdown">
                  {r.inserted > 0 && <span className="chip-new">+{fmt(r.inserted)} new</span>}
                  {r.updated > 0 && <span className="chip-upd">{fmt(r.updated)} updated</span>}
                  {r.skipped > 0 && <span className="chip-skip">{fmt(r.skipped)} unchanged</span>}
                  {r.failed > 0 && <span className="chip-fail">{fmt(r.failed)} failed</span>}
                  {r.inserted === 0 && r.updated === 0 && r.skipped === 0 && r.failed === 0 && (
                    <span className="chip-skip">—</span>
                  )}
                </div>
              </td>
              <td className="num">{fmt(r.pagesScanned)}</td>
              <td>{duration(r)}</td>
              <td title={new Date(r.startedAt).toLocaleString()}>{relativeTime(r.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
