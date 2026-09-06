import { describe, expect, it } from "vitest";

import {
  dismissExistingAuthBrowser,
  getMobileAuthScheme,
  getMobileOAuthCallbackPath,
} from "./oauth";

describe("mobile oauth", () => {
  it("uses each configured build variant's callback scheme", () => {
    expect(getMobileAuthScheme("bob-dev")).toBe("bob-dev");
    expect(getMobileAuthScheme("bob-preview")).toBe("bob-preview");
    expect(getMobileAuthScheme("bob")).toBe("bob");
    expect(getMobileAuthScheme(["bob-dev", "com.gmacko.bob.dev"])).toBe(
      "bob-dev",
    );
    expect(getMobileAuthScheme(undefined)).toBe("bob");
    expect(() => getMobileAuthScheme("")).toThrow("valid native URL scheme");
    expect(getMobileAuthScheme(["", "not a scheme", "bob-dev"])).toBe(
      "bob-dev",
    );
  });

  it("uses a relative callback so the Better Auth Expo plugin builds the deep link", () => {
    expect(getMobileOAuthCallbackPath()).toBe("/");
  });

  it("does not fail OAuth startup when there is no stale browser to dismiss", async () => {
    await expect(
      dismissExistingAuthBrowser(() =>
        Promise.reject(new Error("There is no web browser to dismiss")),
      ),
    ).resolves.toBeUndefined();
  });
});
