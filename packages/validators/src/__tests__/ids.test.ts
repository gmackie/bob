import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  UserId,
  TenantId,
  SessionId,
  ApiKeyId,
  DeviceCodeId,
  TenantMemberRole,
} from "../ids.js";

describe("@gmacko/validators/ids", () => {
  it("accepts valid UUIDs for UUID-branded ids", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(Schema.decodeUnknownSync(TenantId)(id)).toBe(id);
    expect(Schema.decodeUnknownSync(SessionId)(id)).toBe(id);
    expect(Schema.decodeUnknownSync(ApiKeyId)(id)).toBe(id);
    expect(Schema.decodeUnknownSync(DeviceCodeId)(id)).toBe(id);
  });

  it("rejects non-UUIDs for TenantId (UUID brand)", () => {
    expect(() => Schema.decodeUnknownSync(TenantId)("not-a-uuid")).toThrow();
  });

  it("UserId accepts opaque non-UUID strings (better-auth ids)", () => {
    // better-auth generates opaque string ids like "user_abc123", not UUIDs.
    const id = "user_abc123";
    expect(Schema.decodeUnknownSync(UserId)(id)).toBe(id);
  });

  it("UserId still rejects empty strings", () => {
    expect(() => Schema.decodeUnknownSync(UserId)("")).toThrow();
  });

  it("brands ids so UserId and TenantId are not interchangeable", () => {
    const raw = "550e8400-e29b-41d4-a716-446655440000";
    const u: typeof UserId.Type = Schema.decodeUnknownSync(UserId)(raw);
    // @ts-expect-error — UserId is not assignable to TenantId (branded)
    const t: typeof TenantId.Type = u;
  });
});

describe("@gmacko/validators/ids TenantMemberRole", () => {
  it("accepts owner, admin, and member", () => {
    expect(Schema.decodeUnknownSync(TenantMemberRole)("owner")).toBe("owner");
    expect(Schema.decodeUnknownSync(TenantMemberRole)("admin")).toBe("admin");
    expect(Schema.decodeUnknownSync(TenantMemberRole)("member")).toBe("member");
  });

  it("rejects unknown roles like 'viewer'", () => {
    expect(() =>
      Schema.decodeUnknownSync(TenantMemberRole)("viewer"),
    ).toThrow();
  });
});
