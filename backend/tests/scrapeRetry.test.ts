import { describe, expect, it, vi } from "vitest";
import { backoffDelayMs } from "../src/scraper/gemApiScraper";
import { withRetry } from "../src/utils/retry";

describe("backoffDelayMs", () => {
  it("grows exponentially", () => {
    // Jitter pinned to its midpoint so the growth curve is what is asserted.
    const mid = () => 0.5;
    expect(backoffDelayMs(1, 500, mid)).toBe(375); // 500 * 0.75
    expect(backoffDelayMs(2, 500, mid)).toBe(750); // 1000 * 0.75
    expect(backoffDelayMs(3, 500, mid)).toBe(1500); // 2000 * 0.75
    expect(backoffDelayMs(4, 500, mid)).toBe(3000); // 4000 * 0.75
  });

  it("applies jitter within 50-100% of the exponential delay", () => {
    expect(backoffDelayMs(3, 500, () => 0)).toBe(1000); // 2000 * 0.5
    expect(backoffDelayMs(3, 500, () => 1)).toBe(2000); // 2000 * 1.0
  });

  it("caps the delay so a long outage cannot stall the run for minutes", () => {
    expect(backoffDelayMs(20, 500, () => 1)).toBe(30_000);
  });

  it("never returns a negative or zero delay", () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(backoffDelayMs(attempt, 500, () => 0)).toBeGreaterThan(0);
    }
  });
});

describe("withRetry", () => {
  it("returns the first successful result without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("recovered");

    await expect(withRetry(fn, { retries: 4, baseDelayMs: 1 })).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after the configured number of attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("HTTP 503"));
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1, label: "page 7" })).rejects.toThrow(
      /page 7 failed after 3 attempts.*HTTP 503/s
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("surfaces the last error message so page failures are diagnosable", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("GeM rejected page 12"));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow(/GeM rejected page 12/);
  });
});
