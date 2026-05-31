import { describe, expect, it } from "vitest";

import {
  dismissExistingAuthBrowser,
  getMobileOAuthCallbackPath,
} from "./oauth";

describe("mobile oauth", () => {
  it("uses a relative callback so the Better Auth Expo plugin builds the deep link", () => {
    expect(getMobileOAuthCallbackPath()).toBe("/");
  });

  it("does not fail OAuth startup when there is no stale browser to dismiss", async () => {
    await expect(
      dismissExistingAuthBrowser(async () => {
        throw new Error("There is no web browser to dismiss");
      }),
    ).resolves.toBeUndefined();
  });
});
