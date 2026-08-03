const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
export const AUTH_SESSION_EXPIRED_EVENT = "rrp:auth-session-expired";

// Shared page size for search results -- used both when building the
// request and when computing "Showing A-B of C" display math, so the two
// can never drift apart.
export const PAGE_SIZE = 20;

export class ApiError extends Error {
  status?: number;
  aborted?: boolean;
  constructor(message: string, status?: number, aborted?: boolean) {
    super(message);
    this.status = status;
    this.aborted = aborted;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      // The whole API now sits behind a login session cookie -- without
      // this, the browser never sends it cross-origin (frontend :3001,
      // backend :4001) and every request would 401 regardless of login.
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // A caller (e.g. debounced search cancelling a stale request)
      // deliberately aborted this -- not a real failure, so callers can
      // tell it apart from an actual network error and stay silent.
      throw new ApiError("Request aborted", undefined, true);
    }
    // Network-level failure (backend down, CORS, DNS) -- never silently
    // return an empty/zero result for this, surface it as a real error.
    throw new ApiError(`Could not reach the backend at ${API_BASE}. Is it running?`);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {
      /* ignore body parse failure */
    }
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export interface PortalSummary {
  key: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  supportsAssistedScrape: boolean;
  running: boolean;
  tenderCount: number;
  lastRun: {
    id: string;
    status: string;
    mode: string;
    startedAt: string;
    finishedAt: string | null;
    errorMessage: string | null;
    statedTotal: number | null;
  } | null;
  lastSuccessfulScrapeAt: string | null;
}

export interface StatsResponse {
  totalTenders: number;
  totalReported: number;
  gemListedTotal: number;
  newToday: number;
  keywordMatches: number;
  portalsReportingCount: number;
  portalCounts: Record<string, number>;
  reportedTotals: { portal: string; statedTotal: number | null }[];
  portalsEnabled: number;
  portalsTotal: number;
  closingSoon: number;
  lastScrapeAt: string | null;
  generatedAt: string;
}

export function getPortals() {
  return apiFetch<{ portals: PortalSummary[]; count: number }>("/api/portals");
}

export function getStats() {
  return apiFetch<StatsResponse>("/api/tenders/stats");
}

export function triggerScrapePortal(portalKey: string, mode: "full" | "incremental", maxPages?: number) {
  return apiFetch(`/api/scrape/portal/${portalKey}`, {
    method: "POST",
    body: JSON.stringify(maxPages ? { mode, maxPages } : { mode }),
  });
}

export interface StartBatchResult {
  /** False when a batch sweep was already in flight, so nothing new started. */
  accepted: boolean;
  mode: "full" | "incremental";
  started: string[];
  skipped: { portal: string; reason: string }[];
}

/**
 * Returns as soon as the sweep is queued -- a full run across every portal
 * takes tens of minutes, so the backend no longer holds the request open
 * for it. Watch progress via getScrapeRuns().
 */
export function triggerScrapeAll(mode: "all" | "new") {
  const path = mode === "all" ? "/api/scrape/all-portals" : "/api/scrape/new-all-portals";
  return apiFetch<StartBatchResult>(path, { method: "POST" });
}

export function getScrapeRuns(params: { portal?: string; status?: string } = {}) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return apiFetch<{ runs: any[]; count: number }>(`/api/scrape/runs${qs ? `?${qs}` : ""}`);
}

export interface AssistedSession {
  sessionId: string;
  portal: string;
  url: string;
  instructions?: string;
  expiresAt: string;
  reused?: boolean;
}

export interface AssistedSessionStatus {
  sessionId: string;
  portal: string;
  url: string;
  detectedTenders: number;
  detectedTotal: number | null;
  captchaVisible: boolean;
  expiresAt: string;
}

export function startAssistedSession(portalKey: string) {
  return apiFetch<AssistedSession>(`/api/scrape/assisted/${portalKey}/start`, { method: "POST" });
}

export function getAssistedSessionStatus(sessionId: string) {
  return apiFetch<AssistedSessionStatus>(`/api/scrape/assisted/${sessionId}/status`);
}

export function importAssistedSession(sessionId: string) {
  return apiFetch<{
    runId: string;
    portal: string;
    pagesScanned: number;
    found: number;
    inserted: number;
    updated: number;
    skipped: number;
    statedTotal: number | null;
  }>(`/api/scrape/assisted/${sessionId}/import`, { method: "POST" });
}

export function cancelAssistedSession(sessionId: string) {
  return apiFetch<{ cancelled: boolean }>(`/api/scrape/assisted/${sessionId}/cancel`, { method: "POST" });
}

export interface TenderRow {
  id: string;
  portal: string;
  portalName: string;
  tenderId: string;
  title: string;
  organisation: string | null;
  department: string | null;
  state: string | null;
  category: string | null;
  status: string | null;
  relevance: string | null;
  publishedDate: string | null;
  closingDate: string | null;
  tenderURL: string;
}

export interface SearchResponse {
  data: TenderRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  totalMatching: number;
  source: string;
  searchedAt: string;
}

export function searchTenders(
  params: {
    q?: string;
    portals?: string[];
    keywords?: string[];
    relevance?: string;
    page?: number;
    limit?: number;
  },
  signal?: AbortSignal
) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.portals?.length) qs.set("portals", params.portals.join(","));
  if (params.keywords?.length) qs.set("keywords", params.keywords.join(","));
  if (params.relevance) qs.set("relevance", params.relevance);
  qs.set("page", String(params.page ?? 1));
  qs.set("limit", String(params.limit ?? PAGE_SIZE));
  return apiFetch<SearchResponse>(`/api/tenders/search?${qs.toString()}`, { signal });
}

export function getHealth() {
  return apiFetch<{ status: string; database: string }>("/health");
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export function registerAccount(email: string, password: string) {
  return apiFetch<AuthUser>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function login(email: string, password: string) {
  return apiFetch<AuthUser>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function loginWithGoogle(credential: string) {
  return apiFetch<AuthUser>("/api/auth/google", { method: "POST", body: JSON.stringify({ credential }) });
}

export function logout() {
  return apiFetch<{ loggedOut: boolean }>("/api/auth/logout", { method: "POST" });
}

export function getCurrentUser() {
  return apiFetch<AuthUser>("/api/auth/me");
}

export interface AdminSession {
  id: string;
  email: string;
  role: string;
  ipAddress: string | null;
  active: boolean;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

export function getAdminSessions() {
  return apiFetch<{ sessions: AdminSession[]; count: number }>("/api/admin/sessions");
}

export function revokeAdminSession(sessionId: string) {
  return apiFetch<{ revoked: boolean }>(`/api/admin/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: "POST" });
}

export interface AdminUser {
  id: string;
  email: string;
  role: "admin" | "user";
  loginMethods: string[];
  sessionCount: number;
  alertCount: number;
  alertsActive: boolean;
  alertKeywords: string[];
  createdAt: string;
  updatedAt: string;
}

export function getAdminUsers() {
  return apiFetch<{ users: AdminUser[]; count: number }>("/api/admin/users");
}

export function createAdminUser(email: string, password: string, role: "admin" | "user") {
  return apiFetch<{ id: string; email: string; role: "admin" | "user"; createdAt: string }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, role }),
  });
}

export function updateAdminUserRole(userId: string, role: "admin" | "user") {
  return apiFetch<{ id: string; email: string; role: "admin" | "user" }>(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export interface AlertSubscription {
  keywords: string[];
  active: boolean;
}

export interface AlertHistoryEntry {
  id: string;
  portal: string;
  tenderId: string;
  title: string;
  sentAt: string;
}

export function getAlertSubscription() {
  return apiFetch<AlertSubscription>("/api/alerts/subscription");
}

export function saveAlertSubscription(keywords: string[], active: boolean) {
  return apiFetch<AlertSubscription>("/api/alerts/subscription", {
    method: "PUT",
    body: JSON.stringify({ keywords, active }),
  });
}

export function getAlertHistory() {
  return apiFetch<{ history: AlertHistoryEntry[]; count: number }>("/api/alerts/history");
}

export interface BackupSummary {
  name: string;
  createdAt: string;
  sizeBytes: number;
}

export function getBackups() {
  return apiFetch<{ backups: BackupSummary[]; count: number }>("/api/admin/backups");
}

export function runBackupNow() {
  return apiFetch<{ dir: string; counts: Record<string, number> }>("/api/admin/backups/run", { method: "POST" });
}
