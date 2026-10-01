export interface PortalTender {
  portal: string;
  tenderId: string;
  title: string;
  organisation?: string;
  department?: string;
  location?: string;
  state?: string;
  category?: string;
  description?: string;
  estimatedValue?: number;
  emdAmount?: number;
  tenderFee?: number;
  publishedDate?: string; // ISO 8601
  closingDate?: string; // ISO 8601
  openingDate?: string; // ISO 8601
  status?: string;
  tenderURL: string;
  documentURL?: string;
  sourceUpdatedAt?: string;
}

export interface ScrapeOptions {
  runId: string;
  mode: "full" | "incremental";
  maxPages?: number;
  sinceDate?: string;
  signal?: AbortSignal;
  onProgress?: (progress: ScrapeProgress) => void;
}

export interface ScrapeProgress {
  pagesScanned: number;
  tendersFound: number;
  /** The portal's own reported total, when the adapter can read one (e.g. GeM's numFound). */
  statedTotal?: number;
}

export type PortalUnavailableReason =
  | "captcha"
  | "login-required"
  | "js-rendered-needs-browser"
  | "robots-disallow"
  | "blocked"
  | "unreachable"
  | "not-yet-reviewed";

export type PortalAvailability =
  | { available: true }
  | { available: false; reason: PortalUnavailableReason; detail: string };

export interface PortalAdapter {
  key: string;
  name: string;
  baseUrl: string;
  supportsFullScrape: boolean;
  supportsIncrementalScrape: boolean;

  /**
   * Must be called by the orchestrator before every scrape attempt.
   * Adapters that require login/CAPTCHA/JS execution to see tender data
   * return { available: false, reason, detail } here instead of the
   * orchestrator finding out mid-scrape. Never bypass what this reports.
   */
  checkAvailability(): Promise<PortalAvailability>;

  search?(query: string): Promise<PortalTender[]>;
  scrapePage?(page: number): Promise<PortalTender[]>;
  scrapeAll(options: ScrapeOptions): Promise<PortalTender[]>;
  scrapeNew(options: ScrapeOptions): Promise<PortalTender[]>;
}

export interface PortalRateLimit {
  requestsPerMinute: number;
}

export interface PortalRegistryEntry {
  key: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  adapter: PortalAdapter;
  rateLimit: PortalRateLimit;
  concurrency: number;
  requestDelayMs: number;
  /**
   * True for portals with a CAPTCHA-gated *comprehensive* search, whether or
   * not they also have an automatic path. Some (IREPS, Gujarat nProcure)
   * have no scriptable listing at all, so this is their only path. Others
   * (every GePNIC-family portal) have a CAPTCHA-free "latest tenders" widget
   * that the automatic adapter already scrapes on a schedule, but the full
   * historical/comprehensive list lives behind that portal's own CAPTCHA
   * search -- this offers that as an additional, opt-in deep-scrape path.
   * Either way: a real (headed, visible) browser window opens on the
   * machine running the backend so a human solves the CAPTCHA and reaches
   * the results themselves; only the page they're already looking at gets
   * imported. CAPTCHA is never bypassed or automated.
   */
  supportsAssistedScrape?: boolean;
  /**
   * Where the assisted browser window should navigate first. Defaults to
   * baseUrl. Set this when the portal's real "show everything" search lives
   * at a different URL than the scrape adapter's listing entry point (e.g.
   * GePNIC's CAPTCHA-gated FrontEndAdvancedSearch page vs. its CAPTCHA-free
   * home-page "latest tenders" widget).
   */
  assistedStartUrl?: string;
}
