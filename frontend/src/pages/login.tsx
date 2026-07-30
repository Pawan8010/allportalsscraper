import { useState, FormEvent } from "react";
import Link from "next/link";
import { ShieldCheck, LogIn, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { ApiError } from "@/lib/api";
import GoogleSignInButton from "@/components/GoogleSignInButton";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="auth-brand">
          <ShieldCheck size={20} />
          <div>
            <strong>RRP Groups</strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Tender Intelligence</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              style={{ width: "100%" }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              style={{ width: "100%" }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="error-state" style={{ marginBottom: "var(--space-3)", padding: "8px 12px" }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn full" disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <LogIn size={14} />}
            Log in
          </button>
        </form>

        <GoogleSignInButton />

        <div className="auth-switch">
          Don&apos;t have an account? <Link href="/signup">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
