import { describe, expect, it } from "vitest";

import {
  forgeGraphV1Error,
  forgeGraphV1ErrorEnvelopeSchema,
  forgeGraphV1ErrorSchema,
  forgeGraphV1OkItem,
  forgeGraphV1OkItems,
} from "../src/routers/forgegraph-v1";

describe("ForgeGraph API contract v1", () => {
  it("defines a stable error shape", () => {
    const parsed = forgeGraphV1ErrorSchema.safeParse({
      code: "NOT_FOUND",
      message: "Revision not found",
      retriable: false,
      details: { repoId: "r1", revId: "abc" },
    });

    expect(parsed.success).toBe(true);
  });

  it("forgeGraphV1Error returns an error envelope", () => {
    const result = forgeGraphV1Error("VALIDATION", "Bad input", { field: "repoId" });

    expect(result.ok).toBe(false);
    expect(forgeGraphV1ErrorEnvelopeSchema.safeParse(result).success).toBe(true);
  });

  it("forgeGraphV1OkItem returns item envelopes with optional meta", () => {
    const withoutMeta = forgeGraphV1OkItem({ id: "x" });
    expect(withoutMeta).toEqual({ ok: true, item: { id: "x" } });

    const withMeta = forgeGraphV1OkItem({ id: "x" }, { idempotency: { replayed: true } });
    expect(withMeta.ok).toBe(true);
    expect(withMeta.meta).toEqual({ idempotency: { replayed: true } });
  });

  it("forgeGraphV1OkItems returns list envelopes with meta.limit", () => {
    const result = forgeGraphV1OkItems([{ id: "a" }, { id: "b" }], { limit: 20 });
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.meta.limit).toBe(20);
  });
});
