import { useState, FormEvent } from "react";
import Link from "next/link";
import { UserPlus, Loader2, LockKeyhole, Mail } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { ApiError } from "@/lib/api";
import AuthShell from "@/components/AuthShell";

export default function SignupPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create an account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell eyebrow="Create your workspace" title="Start tracking tenders" subtitle="Create an account and turn thousands of portal listings into focused opportunities.">
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <div className="auth-input-wrap"><Mail size={15} /><input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            /></div>
          </div>
          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <div className="auth-input-wrap"><LockKeyhole size={15} /><input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            /></div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>At least 8 characters.</div>
          </div>

          {error && (
            <div className="error-state" style={{ marginBottom: "var(--space-3)", padding: "8px 12px" }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn full" disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />}
            Create account
          </button>
        </form>

        <div className="auth-switch">
          Already have an account? <Link href="/login">Log in</Link>
        </div>
    </AuthShell>
  );
}
