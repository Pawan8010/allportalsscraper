import { useEffect, useState } from "react";
import { CheckCircle2, DatabaseBackup, Loader2, MinusCircle, Power, UserCog } from "lucide-react";
import {
  AdminSession,
  AdminUser,
  ApiError,
  BackupSummary,
  getAdminSessions,
  getAdminUsers,
  getBackups,
  revokeAdminSession,
  runBackupNow,
} from "@/lib/api";
import { useToast } from "@/lib/toast";

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function UsersCard() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const result = await getAdminUsers();
      setUsers(result.users);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card">
      <div className="section-title"><UserCog size={15} /> Users ({users.length})</div>
      {loading ? <div className="loading-state">Loading users…</div> : error ? (
        <div className="error-state">Unable to load users — {error}</div>
      ) : (
        <div className="table-wrap">
          <table className="run-table">
            <thead><tr><th>Email</th><th>Role</th><th>Login</th><th>Sessions</th><th>Alerts</th><th>Joined</th></tr></thead>
            <tbody>{users.map((user) => (
              <tr key={user.id}>
                <td>{user.email}</td>
                <td><span className={`badge ${user.role === "admin" ? "warning" : "muted"}`}>{user.role}</span></td>
                <td>{user.loginMethods.join(" + ") || "—"}</td>
                <td>{user.sessionCount}</td>
                <td>{user.alertsActive ? `${user.alertKeywords.length} keywords` : "off"}</td>
                <td title={new Date(user.createdAt).toLocaleString()}>{relativeTime(user.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SessionsCard() {
  const toast = useToast();
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await getAdminSessions();
        if (!cancelled) { setSessions(result.sessions); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load sessions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  async function revoke(session: AdminSession) {
    try {
      await revokeAdminSession(session.id);
      setSessions((current) => current.map((item) => item.id === session.id ? { ...item, active: false } : item));
      toast.success(`Session for ${session.email} revoked.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not revoke session.");
    }
  }

  if (loading) return <div className="loading-state">Loading sessions…</div>;
  if (error) return <div className="error-state">Unable to load sessions — {error}</div>;
  return (
    <div className="card">
      <div className="section-title">Active sessions ({sessions.length})</div>
      {sessions.length === 0 ? <div className="empty-state">No sessions yet.</div> : (
        <div className="table-wrap"><table className="run-table">
          <thead><tr><th>Email</th><th>Role</th><th>IP address</th><th>Status</th><th>Last active</th><th>Logged in</th><th>Action</th></tr></thead>
          <tbody>{sessions.map((session) => (
            <tr key={session.id}>
              <td>{session.email}</td>
              <td><span className={`badge ${session.role === "admin" ? "warning" : "muted"}`}>{session.role}</span></td>
              <td>{session.ipAddress ?? "—"}</td>
              <td>{session.active ? <span className="badge success"><CheckCircle2 size={12} />active</span> : <span className="badge muted"><MinusCircle size={12} />ended</span>}</td>
              <td title={new Date(session.lastActiveAt).toLocaleString()}>{relativeTime(session.lastActiveAt)}</td>
              <td title={new Date(session.createdAt).toLocaleString()}>{relativeTime(session.createdAt)}</td>
              <td><button className="btn small secondary" disabled={!session.active} onClick={() => void revoke(session)}><Power size={12} />Revoke</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function BackupsCard() {
  const toast = useToast();
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function load() {
    try { setBackups((await getBackups()).backups); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function run() {
    setRunning(true);
    try {
      const { counts } = await runBackupNow();
      toast.success(`Backup complete (${Object.values(counts).reduce((sum, count) => sum + count, 0).toLocaleString("en-IN")} rows).`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Backup failed.");
    } finally { setRunning(false); }
  }

  return (
    <div className="card">
      <div className="section-title"><DatabaseBackup size={15} /> Local backups</div>
      <button className="btn small secondary" onClick={() => void run()} disabled={running} style={{ marginBottom: 12 }}>
        {running ? <Loader2 size={12} className="spin" /> : <DatabaseBackup size={12} />} Run backup now
      </button>
      {loading ? <div className="loading-state">Loading backups…</div> : backups.length === 0 ? <div className="empty-state">No backups yet.</div> : (
        <div className="table-wrap"><table className="run-table">
          <thead><tr><th>Created</th><th>Size</th></tr></thead>
          <tbody>{backups.map((backup) => <tr key={backup.name}><td title={new Date(backup.createdAt).toLocaleString()}>{relativeTime(backup.createdAt)}</td><td>{fmtBytes(backup.sizeBytes)}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

export default function SessionsPanel() {
  return <><UsersCard /><SessionsCard /><BackupsCard /></>;
}
