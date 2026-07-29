const deleteMany = jest.fn(async (_args?: unknown) => ({ count: 0 }));

jest.mock("../../src/services/prisma", () => ({
  prisma: { tender: { deleteMany } },
}));

import { deleteExpiredTenders } from "../../src/services/tenderCleanupService";

describe("deleteExpiredTenders", () => {
  beforeEach(() => {
    deleteMany.mockClear();
  });

  it("deletes tenders whose closingDate is before the cutoff, and returns the count", async () => {
    deleteMany.mockResolvedValueOnce({ count: 42 });

    const result = await deleteExpiredTenders();

    expect(result).toBe(42);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const arg = deleteMany.mock.calls[0][0] as { where: { closingDate: { lt: Date } } };
    expect(arg.where.closingDate.lt).toBeInstanceOf(Date);
    // With the default zero-day grace period, the cutoff should be
    // essentially "now" (within a couple of seconds of test execution).
    expect(Math.abs(arg.where.closingDate.lt.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("returns 0 without error when nothing is expired", async () => {
    deleteMany.mockResolvedValueOnce({ count: 0 });
    const result = await deleteExpiredTenders();
    expect(result).toBe(0);
  });
});
