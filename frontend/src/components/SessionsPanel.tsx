import { useEffect, useState } from "react";
import { CheckCircle2, MinusCircle } from "lucide-react";
import { getAdminSessions, AdminSession, ApiError } from "@/lib/api";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SessionsPanel() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { sessions } = await getAdminSessions();
        if (!cancelled) {
          setSessions(sessions);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load sessions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (loading) return <div className="loading-state">Loading sessions…</div>;
  if (error) return <div className="error-state">Unable to load sessions — {error}</div>;
  if (sessions.length === 0) return <div className="empty-state">No sessions yet.</div>;

  return (
    <div className="card">
      <div className="section-title">
        Active sessions <span style={{ color: "var(--text-muted)" }}>({sessions.length})</span>
      </div>
      <div className="table-wrap">
        <table className="run-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>IP address</th>
              <th>Status</th>
              <th>Last active</th>
              <th>Logged in</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.email}</td>
                <td>
                  <span className={`badge ${s.role === "admin" ? "warning" : "muted"}`}>{s.role}</span>
                </td>
                <td>{s.ipAddress ?? "—"}</td>
                <td>
                  {s.active ? (
                    <span className="badge success">
                      <CheckCircle2 size={12} />
                      active
                    </span>
                  ) : (
                    <span className="badge muted">
                      <MinusCircle size={12} />
                      ended
                    </span>
                  )}
                </td>
                <td title={new Date(s.lastActiveAt).toLocaleString()}>{relativeTime(s.lastActiveAt)}</td>
                <td title={new Date(s.createdAt).toLocaleString()}>{relativeTime(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
