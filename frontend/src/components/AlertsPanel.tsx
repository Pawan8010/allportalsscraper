import { useEffect, useState } from "react";
import { BellRing, Loader2, Mail, Save } from "lucide-react";
import {
  getAlertSubscription,
  saveAlertSubscription,
  getAlertHistory,
  AlertHistoryEntry,
  ApiError,
} from "@/lib/api";
import { KEYWORD_CHIPS } from "@/lib/keywordChips";
import { useToast } from "@/lib/toast";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AlertsPanel() {
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [deliveryEmail, setDeliveryEmail] = useState("");
  const [active, setActive] = useState(true);
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [sub, hist] = await Promise.all([getAlertSubscription(), getAlertHistory()]);
        setSelected(sub.keywords);
        setDeliveryEmail(sub.deliveryEmail);
        setActive(sub.active);
        setHistory(hist.history);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Failed to load your alert settings.");
      } finally {
        setLoading(false);
      }
    }
    load();
    // Only load once on mount -- toast is stable enough for this purpose
    // and re-running on every render would refetch needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleKeyword(k: string) {
    setSelected((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveAlertSubscription(deliveryEmail, selected, active);
      toast.success("Alert preferences saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save your alert settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-state">Loading alert settings…</div>;

  return (
    <>
      <div className="card">
        <div className="section-title">
          <BellRing size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
          Keyword alerts
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 0 }}>
          Pick the keywords you want to be emailed about. New matching tenders are checked after every scrape cycle
          and sent as one digest — the same tender is never emailed twice. Add up to 10 recipients separated by commas.
        </p>

        <div className="alert-settings-grid">
          <label className="alert-email-field">
            <span>Send matching tenders to (up to 10 recipients)</span>
            <div className="auth-input-wrap">
              <Mail size={15} />
              <input className="input" type="text" value={deliveryEmail} onChange={(event) => setDeliveryEmail(event.target.value)} placeholder="alerts@example.com, team@example.com" required />
            </div>
            <small>Separate addresses with commas. Recipients receive the same matched-tender digest.</small>
          </label>
          <label className="alert-toggle">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span><strong>Alert delivery</strong><small>{active ? "Enabled" : "Paused"}</small></span>
          </label>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {KEYWORD_CHIPS.map((k) => (
            <button
              key={k}
              type="button"
              className={`chip ${selected.includes(k) ? "active" : ""}`}
              onClick={() => toggleKeyword(k)}
            >
              {k}
            </button>
          ))}
        </div>

        <button className="btn" onClick={handleSave} disabled={saving || !deliveryEmail.trim() || selected.length === 0}>
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          Save preferences
        </button>
      </div>

      <div className="card">
        <div className="section-title">Recent alerts sent</div>
        {history.length === 0 ? (
          <div className="empty-state alert-empty-state"><Mail size={22} /><strong>No alerts sent yet</strong><span>Saved keyword matches will appear here after a digest is delivered successfully.</span></div>
        ) : (
          <div className="table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th>Portal</th>
                  <th>Title</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.portal}</td>
                    <td>{h.title}</td>
                    <td title={new Date(h.sentAt).toLocaleString()}>{relativeTime(h.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
