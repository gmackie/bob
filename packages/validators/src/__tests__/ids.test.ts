import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { UserId, TenantId, SessionId } from "../ids.js";

describe("@gmacko/validators/ids", () => {
  it("accepts valid UUIDs", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(Schema.decodeUnknownSync(UserId)(id)).toBe(id);
    expect(Schema.decodeUnknownSync(TenantId)(id)).toBe(id);
    expect(Schema.decodeUnknownSync(SessionId)(id)).toBe(id);
  });

  it("rejects non-UUIDs", () => {
    expect(() => Schema.decodeUnknownSync(UserId)("not-a-uuid")).toThrow();
  });

  it("brands ids so UserId and TenantId are not interchangeable", () => {
    const raw = "550e8400-e29b-41d4-a716-446655440000";
    const u: typeof UserId.Type = Schema.decodeUnknownSync(UserId)(raw);
    // @ts-expect-error — UserId is not assignable to TenantId (branded)
    const t: typeof TenantId.Type = u;
  });
});
