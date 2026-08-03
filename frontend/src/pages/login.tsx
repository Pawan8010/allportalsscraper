import { useState, FormEvent } from "react";
import Link from "next/link";
import { LogIn, Loader2, LockKeyhole, Mail } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { ApiError } from "@/lib/api";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import AuthShell from "@/components/AuthShell";

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
    <AuthShell eyebrow="Secure access" title="Welcome back" subtitle="Sign in to search live tenders, manage alerts, and monitor every portal.">
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
            /></div>
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
    </AuthShell>
  );
}
