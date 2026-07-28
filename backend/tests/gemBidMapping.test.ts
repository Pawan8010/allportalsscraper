import { describe, expect, it } from "vitest";
import { mapGemBid } from "../src/scraper/gemApiScraper";

/**
 * GeM returns every field as a single-element array. These fixtures mirror the
 * exact shape of documents from the public /all-bids-data endpoint.
 */
function bid(overrides: Record<string, unknown> = {}) {
  return {
    id: "9235685",
    b_id: [9235685],
    b_bid_number: ["GEM/2026/B/7455778"],
    b_category_name: ["Thermal Weapon Sight as per MHA QR (V2)"],
    bd_category_name: ["Thermal Weapon Sight as per MHA QR (V2)"],
    b_total_quantity: [120],
    b_bid_type: [1],
    b_eval_type: [0],
    final_start_date_sort: ["2026-04-20T00:13:40Z"],
    final_end_date_sort: ["2099-07-27T21:00:00Z"],
    ba_official_details_minName: ["Ministry of Home Affairs"],
    ba_official_details_deptName: ["Department of Jammu, Kashmir and Ladakh Affairs"],
    ...overrides,
  };
}

describe("mapGemBid", () => {
  it("maps a complete bid into the normalized scrape shape", () => {
    const mapped = mapGemBid(bid());
    expect(mapped).not.toBeNull();
    expect(mapped!.tenderId).toBe("GEM/2026/B/7455778");
    expect(mapped!.title).toBe("Thermal Weapon Sight as per MHA QR (V2)");
    expect(mapped!.publishedDateText).toBe("2026-04-20T00:13:40Z");
    expect(mapped!.closingDateText).toBe("2099-07-27T21:00:00Z");
  });

  it("keeps ministry and department distinct instead of writing the ministry into both", () => {
    const mapped = mapGemBid(bid())!;
    expect(mapped.organisation).toBe("Ministry of Home Affairs");
    expect(mapped.department).toBe("Department of Jammu, Kashmir and Ladakh Affairs");
    expect(mapped.organisation).not.toBe(mapped.department);
  });

  it("prefers the untruncated item list for the title", () => {
    // GeM truncates b_category_name to ~100 chars for display; the full list is
    // only in bd_category_name.
    const full = `Full item list ${"x".repeat(200)}`;
    const mapped = mapGemBid(
      bid({ b_category_name: ["Full item list xxxxxxxx (truncated"], bd_category_name: [full] })
    )!;
    expect(mapped.title).toBe(full);
  });

  it("falls back to the BOQ title when no category name is present", () => {
    const mapped = mapGemBid(
      bid({ b_category_name: [], bd_category_name: [], bbt_title: ["Surgical consumables X Ray ECHS"] })
    )!;
    expect(mapped.title).toBe("Surgical consumables X Ray ECHS");
  });

  it("leaves location and state null rather than inventing a value", () => {
    // The public listing endpoint exposes no delivery location; a constant
    // "India" made the card's Location field meaningless.
    const mapped = mapGemBid(bid())!;
    expect(mapped.location).toBeNull();
    expect(mapped.state).toBeNull();
  });

  it("derives status from the closing date rather than asserting LIVE", () => {
    const mapped = mapGemBid(bid())!;
    expect(mapped.statusText).toBeNull();
  });

  it.each([
    [1, 0, "showbidDocument"],
    [5, 0, "showdirectradocumentPdf"],
    [2, 0, "showradocumentPdf"],
    [2, 1, "list-ra-schedules"],
  ])("builds the portal URL GeM itself uses for bid type %i / eval %i", (bidType, evalType, expectedPath) => {
    const mapped = mapGemBid(bid({ b_bid_type: [bidType], b_eval_type: [evalType] }))!;
    expect(mapped.tenderURL).toContain(`/${expectedPath}/9235685`);
    expect(mapped.documentURL).toBe(mapped.tenderURL);
  });

  it("rejects rows with no bid number or no title", () => {
    expect(mapGemBid(bid({ b_bid_number: [] }))).toBeNull();
    expect(mapGemBid(bid({ b_category_name: [], bd_category_name: [], bbt_title: [] }))).toBeNull();
  });

  it("records rate contract and global tender flags in the searchable description", () => {
    const mapped = mapGemBid(bid({ is_rc_bid: [1], ba_is_global_tendering: [1] }))!;
    expect(mapped.description).toContain("Rate Contract");
    expect(mapped.description).toContain("Global Tender");
    expect(mapped.description).toContain("Quantity: 120");
  });

  it("collapses whitespace in every text field", () => {
    const mapped = mapGemBid(bid({ bd_category_name: ["  Thermal   Weapon\n\tSight  "] }))!;
    expect(mapped.title).toBe("Thermal Weapon Sight");
  });
});
