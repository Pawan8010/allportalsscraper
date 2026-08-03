let subscriptions: any[] = [];
let sentLogs: any[] = [];

jest.mock("../../src/services/prisma", () => ({
  prisma: {
    alertSubscription: {
      findMany: jest.fn(async () => subscriptions),
    },
    alertSentLog: {
      findMany: jest.fn(async ({ where }: any) => sentLogs.filter((s) => s.userId === where.userId)),
      createMany: jest.fn(async ({ data }: any) => {
        sentLogs.push(...data);
        return { count: data.length };
      }),
    },
  },
}));

const searchTenders = jest.fn();
jest.mock("../../src/services/searchService", () => ({ searchTenders: (...args: any[]) => searchTenders(...args) }));

const sendAlertEmail = jest.fn();
jest.mock("../../src/services/mailer", () => ({ sendAlertEmail: (...args: any[]) => sendAlertEmail(...args) }));

import { runAlertCycle } from "../../src/services/alertService";

function tender(portal: string, tenderId: string, title = "A tender") {
  return { portal, tenderId, title, portalName: portal, tenderURL: `https://example.invalid/${tenderId}`, closingDate: null };
}

describe("runAlertCycle", () => {
  beforeEach(() => {
    subscriptions = [];
    sentLogs = [];
    searchTenders.mockReset();
    sendAlertEmail.mockReset();
    sendAlertEmail.mockResolvedValue(true);
  });

  it("does nothing when there are no active subscriptions", async () => {
    const result = await runAlertCycle();
    expect(result).toEqual({ usersNotified: 0, tendersSent: 0 });
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  it("sends one batched email per user covering every matched keyword, not one per tender", async () => {
    subscriptions = [
      { userId: "u1", keywords: ["thermal", "nvg"], user: { id: "u1", email: "u1@example.com" } },
    ];
    searchTenders.mockImplementation(async ({ q }: { q: string }) => {
      if (q === "thermal") return { rows: [tender("gem", "t1"), tender("gem", "t2")], total: 2 };
      if (q === "nvg") return { rows: [tender("gem", "t3")], total: 1 };
      return { rows: [], total: 0 };
    });

    const result = await runAlertCycle();

    expect(sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ usersNotified: 1, tendersSent: 3 });
  });

  it("sends to the subscription delivery email when one is configured", async () => {
    subscriptions = [{ userId: "u1", deliveryEmail: "alerts@example.com", keywords: ["thermal"], user: { id: "u1", email: "login@example.com" } }];
    searchTenders.mockResolvedValue({ rows: [tender("gem", "t1")], total: 1 });

    await runAlertCycle();

    expect(sendAlertEmail).toHaveBeenCalledWith("alerts@example.com", expect.any(String), expect.any(String), expect.any(String));
  });

  it("de-duplicates a tender matched by more than one keyword within the same cycle", async () => {
    subscriptions = [{ userId: "u1", keywords: ["thermal", "camera"], user: { id: "u1", email: "u1@example.com" } }];
    searchTenders.mockImplementation(async ({ q }: { q: string }) => {
      // Both keywords hit the exact same tender.
      if (q === "thermal" || q === "camera") return { rows: [tender("gem", "same-tender")], total: 1 };
      return { rows: [], total: 0 };
    });

    const result = await runAlertCycle();
    expect(result.tendersSent).toBe(1);
  });

  it("never re-sends a tender already recorded in AlertSentLog for that user", async () => {
    subscriptions = [{ userId: "u1", keywords: ["thermal"], user: { id: "u1", email: "u1@example.com" } }];
    sentLogs = [{ userId: "u1", portal: "gem", tenderId: "already-sent" }];
    searchTenders.mockResolvedValue({ rows: [tender("gem", "already-sent"), tender("gem", "brand-new")], total: 2 });

    const result = await runAlertCycle();

    expect(result.tendersSent).toBe(1);
    const sentTitles = sentLogs.map((s) => s.tenderId);
    expect(sentTitles).toContain("brand-new");
  });

  it("does not record anything as sent if the email actually failed to send", async () => {
    subscriptions = [{ userId: "u1", keywords: ["thermal"], user: { id: "u1", email: "u1@example.com" } }];
    searchTenders.mockResolvedValue({ rows: [tender("gem", "t1")], total: 1 });
    sendAlertEmail.mockResolvedValue(false);

    const result = await runAlertCycle();

    expect(result.usersNotified).toBe(0);
    expect(sentLogs).toHaveLength(0);
  });

  it("keeps processing other users if one subscription throws", async () => {
    subscriptions = [
      { userId: "broken", keywords: ["x"], user: { id: "broken", email: "broken@example.com" } },
      { userId: "fine", keywords: ["thermal"], user: { id: "fine", email: "fine@example.com" } },
    ];
    searchTenders.mockImplementation(async ({ q }: { q: string }) => {
      if (q === "x") throw new Error("boom");
      return { rows: [tender("gem", "t1")], total: 1 };
    });

    const result = await runAlertCycle();
    expect(result.usersNotified).toBe(1);
    expect(sendAlertEmail).toHaveBeenCalledWith("fine@example.com", expect.any(String), expect.any(String), expect.any(String));
  });
});
