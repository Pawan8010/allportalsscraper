import axios from "axios";
import { PortalAdapter, PortalAvailability, PortalTender, PortalUnavailableReason, ScrapeOptions } from "../portal.types";

/**
 * Factory for portals with no automatic scrape path at all -- whatever the
 * specific blocker (mobile+OTP verification, unreachable host, a live
 * platform whose public API hasn't been reverse-engineered yet), see
 * docs/PORTAL_FEASIBILITY.md and each registry entry's own comment for the
 * live-check finding behind its `reason`/`detail`.
 *
 * These adapters do not scrape anything. They honestly report
 * "unavailable" with a specific reason so the rest of the system (the
 * other, working portals) keeps working normally, per the requirement to
 * never fake data for a portal that cannot be verified.
 */
export function makeGatedStubAdapter(opts: {
  key: string;
  name: string;
  baseUrl: string;
  reason: PortalUnavailableReason;
  detail: string;
}): PortalAdapter {
  return {
    key: opts.key,
    name: opts.name,
    baseUrl: opts.baseUrl,
    supportsFullScrape: false,
    supportsIncrementalScrape: false,

    async checkAvailability(): Promise<PortalAvailability> {
      try {
        await axios.get(opts.baseUrl, { timeout: 10000, validateStatus: () => true });
      } catch {
        // Even if the network probe itself fails, we still report the
        // documented reason rather than a generic "unreachable" — the known
        // blocker (JS rendering / needs review) is the more useful signal.
      }
      return { available: false, reason: opts.reason, detail: opts.detail };
    },

    async scrapeAll(_options: ScrapeOptions): Promise<PortalTender[]> {
      return [];
    },

    async scrapeNew(_options: ScrapeOptions): Promise<PortalTender[]> {
      return [];
    },
  };
}
