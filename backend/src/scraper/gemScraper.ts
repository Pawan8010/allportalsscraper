import { chromium, Browser, Page } from "playwright";
import { config } from "../config/env";
import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";
import { gemSelectors } from "./selectors";
import { resolveUrl } from "./parser";
import { RawScrapedTender } from "../types/scraper";

export interface ScrapeOptions {
  /** Hard cap on number of listing pages to walk, as a safety net (0 = no cap). */
  maxPages?: number;
}

export class GemScraper {
  private browser: Browser | null = null;

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: config.scraperHeadless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  /**
   * Scrapes every public tender listing page, following pagination until
   * either there's no "next" control or `maxPages` is reached.
   */
  async scrapeAll(opts: ScrapeOptions = {}): Promise<RawScrapedTender[]> {
    if (!this.browser) throw new Error("Scraper not launched - call launch() first");

    const maxPages = opts.maxPages ?? 0;
    const listingPage = await this.browser.newPage();
    listingPage.setDefaultNavigationTimeout(config.scraperTimeoutMs);

    const results: RawScrapedTender[] = [];
    let pageNumber = 1;

    try {
      const searchUrl = new URL("/all-bids", config.gemBaseUrl).toString();
      await withRetry(() => listingPage.goto(searchUrl, { waitUntil: "domcontentloaded" }), {
        retries: config.scraperMaxRetries,
        label: `navigate to listing page ${searchUrl}`,
      });

      while (true) {
        logger.info(`[scraper] Scraping listing page ${pageNumber}`);

        await withRetry(
          () =>
            listingPage.waitForFunction(() => document.body.innerText.includes("Bid No.:"), {
              timeout: gemSelectors.listingWaitTimeoutMs,
            }),
          { retries: config.scraperMaxRetries, label: `wait for listing rows on page ${pageNumber}` }
        );

        const rows = await this.extractListingRows(listingPage);
        logger.info(`[scraper] Found ${rows.length} tenders on page ${pageNumber}`);

        for (const row of rows) {
          try {
            const enriched = await this.enrichWithDetail(row);
            results.push(enriched);
          } catch (err) {
            logger.warn(
              `[scraper] Failed to enrich tender ${row.tenderId} from detail page, keeping listing data only: ${
                err instanceof Error ? err.message : err
              }`
            );
            results.push(row);
          }
        }

        if (maxPages > 0 && pageNumber >= maxPages) {
          logger.info(`[scraper] Reached maxPages=${maxPages}, stopping pagination`);
          break;
        }

        const advanced = await this.goToNextPage(listingPage, pageNumber + 1);
        if (!advanced) {
          logger.info("[scraper] No further pages found or pagination failed, stopping");
          break;
        }
        pageNumber += 1;
      }
    } finally {
      await listingPage.close();
    }

    return results;
  }

  /** Extracts every tender row visible on the current listing page. */
  private async extractListingRows(page: Page): Promise<RawScrapedTender[]> {
    const scraped = await page.evaluate((baseUrl) => {
      const xpath = "//text()[contains(., 'Bid No.:')]/..";
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      
      const rows = [];
      for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i) as Element;
        
        let container = node;
        for (let j = 0; j < 5; j++) {
           if (container.parentElement && container.parentElement.textContent && container.parentElement.textContent.includes("Department Name And Address:")) {
               container = container.parentElement;
               break;
           } else if (container.parentElement) {
               container = container.parentElement;
           }
        }

        const text = container.textContent || "";
        
        const tenderIdMatch = text.match(/GEM\/\d{4}\/[A-Z]\/\d+/);
        if (!tenderIdMatch) continue;
        const tenderId = tenderIdMatch[0];

        // Extract full title from popover content if available, fallback to regex
        const itemsAnchor = container.querySelector("a[data-content]");
        let title = "Unknown Title";
        if (itemsAnchor) {
          title = itemsAnchor.getAttribute("data-content") || itemsAnchor.textContent || "Unknown Title";
          title = title.replace(/\s+/g, " ").trim();
        } else {
          const itemsMatch = text.match(/Items:\s*(.*?)\s+(?:Quantity|Department)/);
          title = itemsMatch ? itemsMatch[1].trim() : "Unknown Title";
        }

        // Split department and organisation from HTML structure if available
        let org = "Unknown Organisation";
        let dept = "Unknown Department";
        const deptDiv = container.querySelector(".col-md-5 div:nth-child(2), .col-md-5 .row:nth-child(2)");
        if (deptDiv) {
          const parts = deptDiv.innerHTML.split(/<br\s*\/?>/i);
          if (parts.length > 0) org = parts[0].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
          if (parts.length > 1) dept = parts[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        } else {
          const deptMatch = text.match(/Department Name And Address:\s*(.*?)\s+(?:Start Date|End Date|View)/);
          const rawDept = deptMatch ? deptMatch[1].trim() : "Unknown Dept";
          org = rawDept;
          dept = rawDept;
        }

        const startMatch = text.match(/Start Date:\s*([\d-]+\s+[\d: APM]+)/);
        const endMatch = text.match(/End Date:\s*([\d-]+\s+[\d: APM]+)/);

        const links = Array.from(container.querySelectorAll("a"));
        let tenderURL = baseUrl;
        for (const a of links) {
           const href = a.getAttribute("href");
           if (href && (href.includes("showbidDocument") || href.includes("bidlists") || href.includes(tenderId))) {
               tenderURL = new URL(href, baseUrl).toString();
               break;
           }
        }

        rows.push({
             tenderId,
             title,
             organisation: org,
             department: dept,
             location: "India",
             category: "Goods/Services",
             estimatedValueText: null,
             publishedDateText: startMatch ? startMatch[1] : null,
             closingDateText: endMatch ? endMatch[1] : null,
             tenderURL
        });
      }
      return rows;
    }, config.gemBaseUrl);

    const unique = new Map();
    for (const r of scraped) {
        unique.set(r.tenderId, r);
    }
    return Array.from(unique.values());
  }

  /** Visits a tender's detail page to pick up fields not present in the listing. */
  private async enrichWithDetail(row: RawScrapedTender): Promise<RawScrapedTender> {
    if (!this.browser) throw new Error("Scraper not launched");
    if (!row.tenderURL) return row;

    // Check if the URL points directly to a PDF document (typical for GeM bids)
    const isPdf = row.tenderURL.includes("showbidDocument") || 
                  row.tenderURL.includes("showdirectradocument") || 
                  row.tenderURL.includes("showradocument") || 
                  row.tenderURL.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      // PDF documents cannot be evaluated via HTML DOM queries, so return early
      return {
        ...row,
        documentURL: row.tenderURL,
      };
    }

    const detailPage = await this.browser.newPage();
    detailPage.setDefaultNavigationTimeout(config.scraperTimeoutMs);

    try {
      await withRetry(() => detailPage.goto(row.tenderURL, { waitUntil: "domcontentloaded" }), {
        retries: config.scraperMaxRetries,
        label: `navigate to detail page ${row.tenderURL}`,
      });

      const { detail } = gemSelectors;
      const detailData = await detailPage.evaluate((sel) => {
        function text(selector: string): string | null {
          const el = document.querySelector(selector);
          return el?.textContent?.replace(/\s+/g, " ").trim() || null;
        }
        function href(selector: string): string | null {
          const el = document.querySelector(selector) as HTMLAnchorElement | null;
          return el?.getAttribute("href") || null;
        }

        return {
          description: text(sel.description),
          emdAmountText: text(sel.emdAmount),
          tenderFeeText: text(sel.tenderFee),
          openingDateText: text(sel.openingDate),
          documentHref: href(sel.documentLink),
          statusText: text(sel.status),
        };
      }, detail);

      return {
        ...row,
        description: detailData.description,
        emdAmountText: detailData.emdAmountText,
        tenderFeeText: detailData.tenderFeeText,
        openingDateText: detailData.openingDateText,
        documentURL: resolveUrl(config.gemBaseUrl, detailData.documentHref),
        statusText: detailData.statusText,
      };
    } finally {
      await detailPage.close();
    }
  }

  /** Clicks the "next page" control and waits for targetPage to load via AJAX. */
  private async goToNextPage(page: Page, targetPage: number): Promise<boolean> {
    const nextButton = await page.$("a.page-link:has-text('Next'), a:has-text('Next'), a.next, a[aria-label='Next']");
    if (!nextButton) return false;

    const isDisabled = await nextButton.evaluate((el) => {
      const classList = el.parentElement?.className ?? "";
      return (
        classList.includes("disabled") ||
        el.getAttribute("aria-disabled") === "true" ||
        el.hasAttribute("disabled")
      );
    });
    if (isDisabled) return false;

    await nextButton.click();

    // Wait for the AJAX pagination indicator to update to the target page number
    try {
      await page.waitForFunction(
        (expectedPage) => {
          const currentEl = document.querySelector(
            "#light-pagination span.current, .pagination .current, .pagination .active"
          );
          return currentEl?.textContent?.trim() === String(expectedPage);
        },
        targetPage,
        { timeout: 15000 }
      );
      return true;
    } catch (err) {
      logger.warn(`[scraper] Timeout waiting for pagination to transition to page ${targetPage}: ${err}`);
      return false;
    }
  }
}
