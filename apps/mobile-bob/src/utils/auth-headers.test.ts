import { describe, expect, it } from "vitest";

import { getMobileAuthHeaders } from "./auth-headers";

describe("getMobileAuthHeaders", () => {
  it("sends the development bypass credential as a bearer token", () => {
    expect(
      getMobileAuthHeaders("bob-auth-bypass:prod-secret", true),
    ).toEqual({ Authorization: "Bearer bob-auth-bypass:prod-secret" });
  });

  it("keeps regular Better Auth credentials in the Cookie header", () => {
    expect(
      getMobileAuthHeaders("better-auth.session_token=session.signature", false),
    ).toEqual({ Cookie: "better-auth.session_token=session.signature" });
  });
});
