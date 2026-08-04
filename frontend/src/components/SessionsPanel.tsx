import { useEffect, useState } from "react";
import { CheckCircle2, DatabaseBackup, Loader2, Mail, MinusCircle, Power, Save, Send, Server, UserCog } from "lucide-react";
import {
  AdminSession,
  AdminUser,
  ApiError,
  BackupSummary,
  AdminMailSettings,
  getAdminMailSettings,
  getAdminSessions,
  getAdminUsers,
  getBackups,
  revokeAdminSession,
  runBackupNow,
  saveAdminMailSettings,
  sendAdminTestEmail,
  runAdminAlertCycle,
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

const EMPTY_MAIL_SETTINGS: AdminMailSettings = {
  enabled: false,
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  username: "",
  fromEmail: "",
  passwordConfigured: false,
  source: "environment",
};

function MailSettingsCard() {
  const toast = useToast();
  const [settings, setSettings] = useState<AdminMailSettings>(EMPTY_MAIL_SETTINGS);
  const [password, setPassword] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingAlerts, setSendingAlerts] = useState(false);

  useEffect(() => {
    getAdminMailSettings()
      .then((result) => {
        setSettings(result);
        setTestEmail(result.fromEmail);
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : "Could not load mail settings."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof AdminMailSettings>(key: K, value: AdminMailSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveAdminMailSettings({
        enabled: settings.enabled,
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        username: settings.username,
        fromEmail: settings.fromEmail,
        ...(password ? { password } : {}),
      });
      setSettings(result);
      setPassword("");
      if (!testEmail) setTestEmail(result.fromEmail);
      toast.success("SMTP settings saved securely.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save SMTP settings.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      await sendAdminTestEmail(testEmail);
      toast.success(`Test email sent to ${testEmail}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "SMTP test failed.");
    } finally {
      setTesting(false);
    }
  }

  async function sendMatchedAlerts() {
    setSendingAlerts(true);
    try {
      const result = await runAdminAlertCycle();
      toast.success(`Alert cycle complete: ${result.tendersSent} tenders sent to ${result.usersNotified} users.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not run the alert cycle.");
    } finally {
      setSendingAlerts(false);
    }
  }

  if (loading) return <div className="loading-state">Loading mail settings…</div>;
  return (
    <div className="card">
      <div className="section-title"><Mail size={15} /> Email delivery</div>
      <p className="admin-card-copy">Configure the SMTP account used for matched-tender digests. The password is encrypted and is never returned to the browser.</p>
      <div className="mail-settings-grid">
        <label><span>SMTP host</span><div className="auth-input-wrap"><Server size={15} /><input className="input" value={settings.host} onChange={(event) => update("host", event.target.value)} /></div></label>
        <label><span>Port</span><input className="input" type="number" min={1} max={65535} value={settings.port} onChange={(event) => update("port", Number(event.target.value))} /></label>
        <label><span>SMTP username</span><input className="input" type="email" value={settings.username} onChange={(event) => update("username", event.target.value)} /></label>
        <label><span>From email</span><input className="input" type="email" value={settings.fromEmail} onChange={(event) => update("fromEmail", event.target.value)} /></label>
        <label className="mail-password"><span>SMTP app password</span><input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={settings.passwordConfigured ? "Saved — leave blank to keep" : "Enter app password"} /></label>
        <div className="mail-options">
          <label><input type="checkbox" checked={settings.secure} onChange={(event) => update("secure", event.target.checked)} /> TLS/SSL</label>
          <label><input type="checkbox" checked={settings.enabled} onChange={(event) => update("enabled", event.target.checked)} /> Enable delivery</label>
        </div>
      </div>
      <div className="mail-settings-actions">
        <button className="btn" onClick={() => void save()} disabled={saving || !settings.host || !settings.username || !settings.fromEmail || (!password && !settings.passwordConfigured)}>{saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save mail settings</button>
        <input className="input" type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="Test recipient email" />
        <button className="btn secondary" onClick={() => void sendTest()} disabled={testing || !settings.passwordConfigured || !testEmail}>{testing ? <Loader2 size={13} className="spin" /> : <Send size={13} />} Send test</button>
        <button className="btn secondary" onClick={() => void sendMatchedAlerts()} disabled={sendingAlerts || !settings.enabled || !settings.passwordConfigured}>{sendingAlerts ? <Loader2 size={13} className="spin" /> : <Send size={13} />} Send matched alerts now</button>
      </div>
      <div className="assisted-hint">Source: {settings.source}. {settings.passwordConfigured ? "Password configured." : "Password not configured."}</div>
    </div>
  );
}

export default function SessionsPanel() {
  return <><MailSettingsCard /><UsersCard /><SessionsCard /><BackupsCard /></>;
}
