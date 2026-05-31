import { describe, expect, it, vi } from "vitest";

import { assertPlanLimitAvailable, PLAN_LIMITS } from "./plan-limits";

function createSelectMock(rowsByCall: unknown[][]) {
  return vi.fn(() => {
    const rows = rowsByCall.shift() ?? [];
    const builder = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn(() => Promise.resolve(rows)),
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  });
}

describe("plan limit middleware", () => {
  it("rejects creation when the free app limit is exhausted", async () => {
    const db = {
      select: createSelectMock([
        [{ plan: "free" }],
        [{ count: PLAN_LIMITS.free.apps }],
      ]),
    };

    await expect(
      assertPlanLimitAvailable(db, {
        tenantId: "tenant-1",
        resource: "apps",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows pro tenants without reading usage counts", async () => {
    const db = {
      select: createSelectMock([]),
    };

    await expect(
      assertPlanLimitAvailable(db, {
        tenantId: "tenant-1",
        plan: "pro",
        resource: "storageWrites",
      }),
    ).resolves.toBeUndefined();

    expect(db.select).not.toHaveBeenCalled();
  });
});
