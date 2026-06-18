import { describe, expect, it } from "vitest";

import {
  createDevAuthSession,
  getDevAuthBypassCookie,
  isDevAuthBypassEnabled,
  shouldSkipOnboardingForDevAuth,
} from "./dev-auth-bypass";

describe("dev auth bypass", () => {
  it("is disabled unless an explicit bypass flag is present", () => {
    expect(isDevAuthBypassEnabled({})).toBe(false);
    expect(isDevAuthBypassEnabled({ EXPO_PUBLIC_BOB_AUTH_BYPASS: "false" })).toBe(false);
    expect(isDevAuthBypassEnabled({ EXPO_PUBLIC_BOB_AUTH_BYPASS: "true" })).toBe(true);
  });

  it("uses the configured user id for the fake mobile session", () => {
    const session = createDevAuthSession({
      EXPO_PUBLIC_BOB_AUTH_BYPASS_TOKEN: "prod-secret",
      EXPO_PUBLIC_BOB_AUTH_BYPASS_USER_ID: "user-123",
    });

    expect(session.user.id).toBe("user-123");
    expect(session.user.email).toBe("user-123@dev.bob.local");
    expect(session.session.token).toBe("bob-auth-bypass:prod-secret");
  });

  it("returns a raw gateway token for the configured bypass secret", () => {
    expect(
      getDevAuthBypassCookie({
        EXPO_PUBLIC_BOB_AUTH_BYPASS_TOKEN: "prod-secret",
      }),
    ).toBe("bob-auth-bypass:prod-secret");
  });

  it("skips onboarding only when the dev auth bypass is enabled", () => {
    expect(shouldSkipOnboardingForDevAuth({})).toBe(false);
    expect(
      shouldSkipOnboardingForDevAuth({
        EXPO_PUBLIC_BOB_AUTH_BYPASS: "true",
      }),
    ).toBe(true);
    expect(
      shouldSkipOnboardingForDevAuth({
        EXPO_PUBLIC_BOB_AUTH_BYPASS: "false",
        EXPO_PUBLIC_BOB_SKIP_ONBOARDING: "true",
      }),
    ).toBe(true);
  });
});
