import { PortalTender } from "../portal.types";

const GEM_ORIGIN = "https://bidplus.gem.gov.in";

export type GemBidDoc = Record<string, unknown>;

function firstValue<T = unknown>(value: unknown): T | null {
  if (Array.isArray(value)) return value.length ? (value[0] as T) : null;
  return value === undefined || value === null ? null : (value as T);
}

function clean(value: unknown): string | null {
  const raw = firstValue(value);
  if (raw === null) return null;
  const text = String(raw).replace(/\s+/g, " ").trim();
  return text || null;
}

function isoDate(value: unknown): string | undefined {
  const text = clean(value);
  if (!text) return undefined;
  const date = new Date(text);
  return isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Maps one Solr-style bid document from bidplus.gem.gov.in/all-bids-data
 * into our PortalTender shape. Field names (b_bid_number, bd_category_name,
 * ba_official_details_deptName, final_end_date_sort, ...) come straight from
 * a live capture of that endpoint's real JSON response, not documentation --
 * GeM does not publish an API reference for this internal endpoint.
 */
export function mapGemBid(bid: GemBidDoc): PortalTender | null {
  const tenderId = clean(bid.b_bid_number);
  const bidNumericId = clean(bid.b_id) ?? clean(bid.id);

  // GeM truncates b_category_name to ~100 characters for display; the full
  // item list lives in bd_category_name. Prefer the untruncated value.
  const fullItems = clean(bid.bd_category_name);
  const shortItems = clean(bid.b_category_name);
  const title = fullItems ?? shortItems;
  if (!tenderId || !title) return null;

  const bidType = firstValue<number>(bid.b_bid_type);
  const evalType = firstValue<number>(bid.b_eval_type) ?? 0;
  let documentPath = "showbidDocument";
  if (bidType === 5) documentPath = "showdirectradocumentPdf";
  if (bidType === 2) documentPath = evalType > 0 ? "list-ra-schedules" : "showradocumentPdf";
  const tenderURL = bidNumericId ? `${GEM_ORIGIN}/${documentPath}/${bidNumericId}` : `${GEM_ORIGIN}/all-bids`;

  const ministry = clean(bid.ba_official_details_minName);
  const department = clean(bid.ba_official_details_deptName);
  const organisation = clean(bid.ba_official_details_orgName) ?? ministry ?? undefined;
  const quantity = clean(bid.b_total_quantity);
  const estimatedValue = clean(bid.b_total_value);
  const isRateContract = firstValue<number>(bid.is_rc_bid) === 1;
  const isGlobalTender = firstValue<number>(bid.ba_is_global_tendering) === 1;

  return {
    portal: "gem",
    tenderId,
    title,
    organisation,
    department: department ?? ministry ?? undefined,
    category: shortItems ?? "GeM Bid",
    description:
      [
        quantity ? `Quantity: ${quantity}` : null,
        isRateContract ? "Rate Contract" : null,
        isGlobalTender ? "Global Tender" : null,
      ]
        .filter(Boolean)
        .join(" | ") || undefined,
    estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
    publishedDate: isoDate(bid.final_start_date_sort),
    closingDate: isoDate(bid.final_end_date_sort),
    tenderURL,
    documentURL: tenderURL,
    status: "active",
  };
}

export function mapGemBidPage(docs: unknown): PortalTender[] {
  if (!Array.isArray(docs)) return [];
  return (docs as GemBidDoc[]).map(mapGemBid).filter((t): t is PortalTender => t !== null);
}
