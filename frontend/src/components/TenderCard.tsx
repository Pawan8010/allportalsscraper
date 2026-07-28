import { useState } from "react";
import { Building2, ShieldCheck, MapPin, CalendarDays, Clock, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { TenderRow } from "@/lib/api";

// GeM "custom bid" titles are sometimes a single comma-separated list of
// every line item on the bid (real data, not a parsing bug) and can run to
// dozens of items. Clamping keeps the results list scannable; the toggle
// lets anyone who actually needs the full item list read it in place
// instead of leaving the page.
const CLAMP_LENGTH = 140;

const DAY_MS = 24 * 60 * 60 * 1000;

// A few portals have an established short form that suffix-stripping alone
// can't reconstruct ("Government e-Marketplace" isn't "GeM" by any regex).
const PORTAL_SHORT_NAMES: Record<string, string> = {
  gem: "GeM",
  cppp: "CPPP",
  ireps: "IREPS",
};

/** "Maharashtra eProcurement" -> "Maharashtra"; "Coal India e-Procurement" -> "Coal India". */
function shortPortalName(portalKey: string, portalName: string): string {
  if (PORTAL_SHORT_NAMES[portalKey]) return PORTAL_SHORT_NAMES[portalKey];
  const stripped = portalName
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*e-?Procurement(\s+(System|Portal))?\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || portalName;
}

function closingUrgency(closingDate: string | null): "closed" | "urgent" | "soon" | "normal" | null {
  if (!closingDate) return null;
  const diff = new Date(closingDate).getTime() - Date.now();
  if (diff < 0) return "closed";
  if (diff <= DAY_MS) return "urgent";
  if (diff <= 3 * DAY_MS) return "soon";
  return "normal";
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TenderCard({ tender }: { tender: TenderRow }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = tender.title.length > CLAMP_LENGTH;
  const urgency = closingUrgency(tender.closingDate);
  const shortName = shortPortalName(tender.portal, tender.portalName);

  return (
    <div className={`tender-card ${urgency ? `urgency-${urgency}` : ""}`}>
      <div className="tender-card-top">
        <div className="tender-card-heading">
          <div className="tender-id">{tender.tenderId}</div>
          <h3 className={expanded ? "" : "clamp"}>{tender.title}</h3>
          {isLong && (
            <button type="button" className="expand-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? "Show less" : "Show full item list"}
            </button>
          )}
        </div>
        <a href={tender.tenderURL} target="_blank" rel="noreferrer" className="open-portal-btn">
          Open {shortName} Portal
          <ExternalLink size={13} />
        </a>
      </div>

      <div className="meta">
        {tender.organisation && (
          <span title={tender.organisation}>
            <Building2 size={13} />
            {tender.organisation}
          </span>
        )}
        {tender.department && tender.department !== tender.organisation && (
          <span title={tender.department}>
            <ShieldCheck size={13} />
            {tender.department}
          </span>
        )}
        {tender.state && (
          <span>
            <MapPin size={13} />
            {tender.state}
          </span>
        )}
      </div>

      <div className="pill-row">
        <span className="pill pill-source">Source: {shortName}</span>
        {tender.status && <span className="pill">Status: {tender.status.toUpperCase()}</span>}
        {tender.publishedDate && (
          <span className="pill">
            <CalendarDays size={12} />
            Published: {fmtDateTime(tender.publishedDate)}
          </span>
        )}
        {tender.closingDate && (
          <span className={`pill pill-closing ${urgency ?? ""}`}>
            <Clock size={12} />
            {urgency === "closed" ? "Closed" : "Closes"}: {fmtDateTime(tender.closingDate)}
          </span>
        )}
      </div>
    </div>
  );
}
