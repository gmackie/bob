import { describe, expect, it } from "vitest";

import { VERSION } from "../index";

describe("@ooda/buddy-tools smoke", () => {
  it("exports VERSION", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
