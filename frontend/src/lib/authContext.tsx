import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/router";
import { AuthUser, getCurrentUser, login as apiLogin, logout as apiLogout, registerAccount, ApiError } from "./api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Paths a logged-out visitor can view without being bounced to /login.
// "/" is the public landing page for a logged-out visitor, or the
// dashboard for a logged-in one -- pages/index.tsx itself decides which,
// so it must never be force-redirected away from either way.
const PUBLIC_PATHS = new Set(["/", "/login", "/signup"]);
// Paths a logged-in visitor gets bounced away from, back to "/" -- there's
// no reason to show a login/signup form to someone already signed in.
const AUTH_FORM_PATHS = new Set(["/login", "/signup"]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refreshUser = useCallback(async () => {
    try {
      setUser(await getCurrentUser());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
    // Only run once on mount -- refreshUser is stable (useCallback, no
    // deps), and login()/register()/logout() below update `user` directly
    // rather than relying on this effect to re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    if (user && AUTH_FORM_PATHS.has(router.pathname)) {
      void router.replace("/");
    } else if (!user && !PUBLIC_PATHS.has(router.pathname)) {
      void router.replace("/login");
    }
  }, [user, loading, router, router.pathname]);

  const value: AuthContextValue = {
    user,
    loading,
    login: async (email, password) => {
      setUser(await apiLogin(email, password));
    },
    register: async (email, password) => {
      setUser(await registerAccount(email, password));
    },
    logout: async () => {
      await apiLogout().catch(() => undefined);
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be called within an AuthProvider");
  return ctx;
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
