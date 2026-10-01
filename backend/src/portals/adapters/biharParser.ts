import { PortalTender } from "../portal.types";

const LISTING_URL = "https://eproc2.bihar.gov.in/EPSV2Web/openarea/tenderListingPage.action";

export interface BiharTender {
  currenttenderid?: number;
  currentOrgTenderId?: number;
  currenttenderrefno?: string | null;
  currentdescription?: string | null;
  currentdeptid?: number;
  currentorgid?: number;
  currentbidEndDate?: number | null;
  currentbidStartDate?: number | null;
  currentbidOpenDate?: number | null;
  currentTenderPublishDate?: number | null;
}

function toIso(epochMs: number | null | undefined): string | undefined {
  return epochMs ? new Date(epochMs).toISOString() : undefined;
}

export function mapBiharTender(t: BiharTender): PortalTender | null {
  const tenderId = String(t.currentOrgTenderId ?? t.currenttenderid ?? "").trim();
  const title = (t.currentdescription ?? "").replace(/\s+/g, " ").trim();
  if (!tenderId || !title) return null;

  const reference = (t.currenttenderrefno ?? "").trim();

  return {
    portal: "bihar",
    tenderId,
    title,
    organisation: t.currentorgid ? `Bihar Organisation ${t.currentorgid}` : undefined,
    department: t.currentdeptid ? `Department ${t.currentdeptid}` : undefined,
    state: "Bihar",
    category: "Government eProcurement",
    description: [title, reference].filter(Boolean).join(" | ") || undefined,
    publishedDate: toIso(t.currentTenderPublishDate),
    closingDate: toIso(t.currentbidEndDate),
    openingDate: toIso(t.currentbidOpenDate),
    tenderURL: `${LISTING_URL}#latestTenders`,
    status: "active",
  };
}

export function mapBiharTenderList(rows: unknown): PortalTender[] {
  if (!Array.isArray(rows)) return [];
  return (rows as BiharTender[]).map(mapBiharTender).filter((t): t is PortalTender => t !== null);
}
