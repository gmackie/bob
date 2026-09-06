import { expect, it } from "vitest";
import { mobileTrustedOrigins } from "./trusted-origins";
it("trusts only the three registered native app schemes", () => {
  expect([...mobileTrustedOrigins]).toEqual(["bob://", "bob-dev://", "bob-preview://"]);
  expect(mobileTrustedOrigins.some((origin) => origin.includes("*"))).toBe(false);
});
