import { ReactNode, useState } from "react";
import {
  Search,
  Radar,
  History,
  Layers,
  RefreshCw,
  Loader2,
  ShieldCheck,
  Menu,
  X,
} from "lucide-react";

export type View = "search" | "portals" | "activity";

interface NavItem {
  id: View;
  label: string;
  icon: typeof Search;
  count?: number;
  live?: boolean;
}

interface Props {
  view: View;
  onViewChange: (v: View) => void;
  navCounts: { search: number; portals: number; activity: number };
  /** Number of portals currently mid-scrape -- drives the live indicator. */
  activeRuns: number;
  scrapingBatch: boolean;
  onScrapeAll: (mode: "all" | "new") => void;
  lastUpdated: Date | null;
  subtitle: string;
  children: ReactNode;
}

const TITLES: Record<View, string> = {
  search: "Tender Search",
  portals: "Portal Status",
  activity: "Scrape Activity",
};

function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

export default function AppShell({
  view,
  onViewChange,
  navCounts,
  activeRuns,
  scrapingBatch,
  onScrapeAll,
  lastUpdated,
  subtitle,
  children,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav: NavItem[] = [
    { id: "search", label: "Search", icon: Search, count: navCounts.search },
    { id: "portals", label: "Portals", icon: Radar, count: navCounts.portals },
    { id: "activity", label: "Activity", icon: History, count: navCounts.activity, live: activeRuns > 0 },
  ];

  function pick(v: View) {
    onViewChange(v);
    setMobileOpen(false);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <div className="brand-text">
            <strong>RRP Groups</strong>
            <span>Tender Intelligence</span>
          </div>
          <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => pick(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={16} />
              <span className="nav-label">{item.label}</span>
              {item.count !== undefined && (
                <span className={`nav-count ${item.live ? "live" : ""}`}>{fmt(item.count)}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-heading">Global actions</div>
          <button className="btn secondary full" disabled={scrapingBatch} onClick={() => onScrapeAll("new")}>
            {scrapingBatch ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            Scrape New
          </button>
          <button className="btn full" disabled={scrapingBatch} onClick={() => onScrapeAll("all")}>
            {scrapingBatch ? <Loader2 size={15} className="spin" /> : <Layers size={15} />}
            Full Sweep
          </button>
        </div>

        <div className="sidebar-footer">
          <div className={`run-indicator ${activeRuns > 0 ? "active" : ""}`}>
            <span className="live-dot" />
            {activeRuns > 0 ? `${activeRuns} portal${activeRuns === 1 ? "" : "s"} scraping` : "Idle"}
          </div>
        </div>
      </aside>

      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      <div className="shell-main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="topbar-title">
            <h1>{TITLES[view]}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="topbar-meta">
            {lastUpdated && (
              <span title={lastUpdated.toLocaleString()}>
                Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </header>

        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
