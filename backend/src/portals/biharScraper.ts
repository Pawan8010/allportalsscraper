import { RawScrapedTender } from "../types/scraper";
import { CurlSession } from "./curlSession";
import { PortalDefinition } from "./portalRegistry";

type BiharTender = {
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
};

function timestampText(value: number | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function mapBiharTender(tender: BiharTender, portal: PortalDefinition): RawScrapedTender | null {
  const tenderId = String(tender.currentOrgTenderId ?? tender.currenttenderid ?? "").trim();
  const title = String(tender.currentdescription ?? "").replace(/\s+/g, " ").trim();
  if (!tenderId || !title) return null;

  const reference = String(tender.currenttenderrefno ?? "").trim();
  const internalId = tender.currenttenderid ?? tender.currentOrgTenderId;
  const tenderURL = internalId
    ? `${portal.baseUrl}/openarea/tenderListingPage.action#latestTenders`
    : `${portal.baseUrl}/openarea/tenderListingPage.action`;

  return {
    portal: portal.shortName,
    tenderId,
    title,
    organisation: tender.currentorgid ? `Bihar Organisation ${tender.currentorgid}` : portal.name,
    department: tender.currentdeptid ? `Department ${tender.currentdeptid}` : null,
    location: "Bihar",
    state: "Bihar",
    category: "Government eProcurement",
    description: [title, reference].filter(Boolean).join(" | "),
    publishedDateText: timestampText(tender.currentTenderPublishDate),
    closingDateText: timestampText(tender.currentbidEndDate),
    openingDateText: timestampText(tender.currentbidOpenDate),
    tenderURL,
    documentURL: null,
    statusText: "LIVE",
  };
}

export async function scrapeBiharPortal(portal: PortalDefinition): Promise<RawScrapedTender[]> {
  const session = await CurlSession.create("bihar");
  try {
    const listingUrl = `${portal.baseUrl}/openarea/tenderListingPage.action`;
    const html = await session.get(listingUrl);
    const authorization = html.match(/id=["']Authorization["'][^>]*value=["']([^"']+)["']/i)?.[1];
    if (!authorization) throw new Error("Bihar public tender page did not provide a session token");

    const response = await session.post(
      `${portal.baseUrl}/rest/openarea/getTenderList`,
      "{}",
      {
        Authorization: authorization,
        "Auth-Token": "X-Requested-With",
        "Content-Type": "application/json;charset=utf-8",
        Referer: listingUrl,
      }
    );
    const rows = JSON.parse(response) as BiharTender[];
    if (!Array.isArray(rows)) throw new Error("Bihar public tender endpoint returned an invalid response");

    return rows
      .map((row) => mapBiharTender(row, portal))
      .filter((row): row is RawScrapedTender => row !== null);
  } finally {
    await session.dispose();
  }
}
