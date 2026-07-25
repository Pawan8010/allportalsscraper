/** Raw shape of a tender as scraped off a GeM listing/detail page, before normalization. */
export interface RawScrapedTender {
  /** Human-readable source portal. Defaults to GeM for legacy callers. */
  portal?: string;
  tenderId: string;
  title: string;
  organisation?: string | null;
  department?: string | null;
  location?: string | null;
  state?: string | null;
  category?: string | null;
  description?: string | null;
  estimatedValueText?: string | null;
  emdAmountText?: string | null;
  tenderFeeText?: string | null;
  publishedDateText?: string | null;
  closingDateText?: string | null;
  openingDateText?: string | null;
  tenderURL: string;
  documentURL?: string | null;
  statusText?: string | null;
}
