import { Database, ShieldCheck, RefreshCw, CalendarDays, Search } from "lucide-react";
import { StatsResponse } from "@/lib/api";
import { SkeletonBar } from "@/components/Skeleton";

function fmt(n: number | undefined) {
  return (n ?? 0).toLocaleString("en-IN");
}

const CARDS = [
  {
    key: "totalTenders",
    icon: Database,
    label: "Stored Tenders",
    hint: (s: StatsResponse) => `across ${fmt(s.portalsEnabled)} active portals`,
  },
  {
    key: "gemListedTotal",
    icon: ShieldCheck,
    label: "GeM Listed",
    hint: () => "Government e-Marketplace",
  },
  {
    key: "newToday",
    icon: RefreshCw,
    label: "New Today",
    hint: (s: StatsResponse) =>
      s.lastScrapeAt
        ? `last scrape ${new Date(s.lastScrapeAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "no scrape yet",
  },
  {
    key: "closingSoon",
    icon: CalendarDays,
    label: "Closing Soon",
    hint: () => "bids closing shortly",
  },
  {
    key: "keywordMatches",
    icon: Search,
    label: "Keyword Matches",
    hint: () => "against the watchlist",
  },
] as const;

export default function StatsBar({ stats, loading }: { stats: StatsResponse | null; loading: boolean }) {
  const pending = loading || !stats;
  return (
    <div className="stats-grid">
      {CARDS.map(({ key, icon: Icon, label, hint }) => (
        <div className="stat-card" key={key}>
          <div className="stat-card-top">
            <div className="stat-icon">
              <Icon size={16} />
            </div>
            <div className="stat-label">{label}</div>
          </div>
          {pending ? <SkeletonBar width={90} height={28} /> : <div className="stat-value">{fmt(stats[key])}</div>}
          <div className="stat-hint">{pending ? <SkeletonBar width={110} height={11} /> : hint(stats)}</div>
        </div>
      ))}
    </div>
  );
}
