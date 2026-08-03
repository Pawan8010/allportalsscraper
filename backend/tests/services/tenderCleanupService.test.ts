const deleteMany = jest.fn(async (_args?: unknown) => ({ count: 0 }));
const findMany = jest.fn(async (_args?: unknown) => [] as Array<{ portal: string; tenderId: string; closingDate: Date }>);
const createMany = jest.fn(async (_args?: unknown) => ({ count: 0 }));

jest.mock("../../src/services/prisma", () => ({
  prisma: {
    tender: { findMany, deleteMany },
    expiredTender: { createMany },
    $transaction: jest.fn(async (callback: (transaction: unknown) => unknown) =>
      callback({ tender: { deleteMany }, expiredTender: { createMany } })
    ),
  },
}));

import { deleteExpiredTenders } from "../../src/services/tenderCleanupService";

describe("deleteExpiredTenders", () => {
  beforeEach(() => {
    deleteMany.mockClear();
    findMany.mockClear();
    createMany.mockClear();
  });

  it("deletes tenders whose closingDate is before the cutoff, and returns the count", async () => {
    findMany.mockResolvedValueOnce([
      { portal: "gem", tenderId: "closed-1", closingDate: new Date(Date.now() - 1000) },
    ]);
    deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await deleteExpiredTenders();

    expect(result).toBe(1);
    expect(createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ portal: "gem", tenderId: "closed-1" }),
      ]),
      skipDuplicates: true,
    });
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const arg = deleteMany.mock.calls[0][0] as { where: { closingDate: { lt: Date } } };
    expect(arg.where.closingDate.lt).toBeInstanceOf(Date);
    // With the default zero-day grace period, the cutoff should be
    // essentially "now" (within a couple of seconds of test execution).
    expect(Math.abs(arg.where.closingDate.lt.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("returns 0 without error when nothing is expired", async () => {
    findMany.mockResolvedValueOnce([]);
    const result = await deleteExpiredTenders();
    expect(result).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
