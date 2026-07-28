/**
 * ============================================================================
 * SELECTOR CONFIG - inspect the live GeM site and adjust these if they drift.
 * ============================================================================
 *
 * Every other file in the scraper (gemScraper.ts, parser.ts) is written
 * against this config rather than hardcoding selectors, so that when GeM
 * changes its markup you only need to update this one file.
 *
 * How to refresh these:
 *   1. Open https://mkp.gem.gov.in/ (or the current public tender search URL)
 *      in a normal browser with devtools open.
 *   2. Search for any term to load a results listing.
 *   3. Right-click a single tender row/card -> Inspect, and note the
 *      containing element's selector, then find the selector for each
 *      field below relative to that container.
 *   4. Repeat for the "next page" control and for a tender detail page,
 *      then update the corresponding field below.
 *
 * The values below are reasonable, best-effort defaults based on how public
 * GeM search/listing pages have historically been structured (Bootstrap-style
 * card/table rows), but were NOT verified against a live page load in this
 * environment - treat them as a starting point, not ground truth.
 */

export const gemSelectors = {
  /** Public tender search/listing page path (relative to GEM_BASE_URL). */
  searchPath: "/tenders/all-tenders",

  /** Container for a single tender row/card in the listing page. */
  listingRow: "table.table tbody tr, .tender-list-item, .card.tender-card",

  /** Fields relative to `listingRow`. */
  fields: {
    tenderId: ".tender-id, td:nth-child(1), [data-field='bid_no']",
    title: ".tender-title, td:nth-child(2) a, [data-field='title']",
    organisation: ".organisation, [data-field='ministry']",
    department: ".department, [data-field='department']",
    location: ".location, [data-field='location']",
    category: ".category, [data-field='category']",
    estimatedValue: ".estimated-value, [data-field='value']",
    publishedDate: ".published-date, [data-field='start_date']",
    closingDate: ".closing-date, [data-field='end_date']",
    detailLink: "a.tender-link, td a[href*='/show_bid'], a[href*='/tender/']",
  },

  /** "Next page" control on the listing page (used to paginate through all results). */
  pagination: {
    nextButton: "a.next, li.next a, a[aria-label='Next']",
    // If GeM exposes page numbers instead of a next-button, use this to detect the last page.
    activePageIndicator: "li.active a, .pagination .active",
  },

  /** Tender detail page selectors (when following `detailLink`). */
  detail: {
    description: ".tender-description, #description, [data-field='description']",
    emdAmount: ".emd-amount, [data-field='emd']",
    tenderFee: ".tender-fee, [data-field='tender_fee']",
    openingDate: ".opening-date, [data-field='bid_opening_date']",
    documentLink: "a.download-document, a[href$='.pdf']",
    status: ".tender-status, .status-badge",
  },

  /** How long to wait for the listing container to appear after navigation (ms). */
  listingWaitTimeoutMs: 20000,
};
