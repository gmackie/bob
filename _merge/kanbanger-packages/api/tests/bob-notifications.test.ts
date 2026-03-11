import { describe, expect, it } from "vitest";

import { countConsecutiveFailedToStart } from "../src/routers/agent";

describe("Bob notification helpers", () => {
  it("counts consecutive failed-to-start runs from the most recent run backward", () => {
    expect(
      countConsecutiveFailedToStart([
        "failed_to_start",
        "failed_to_start",
        "in_progress",
        "failed_to_start",
      ]),
    ).toBe(2);
  });

  it("stops counting once a non-failed run appears", () => {
    expect(
      countConsecutiveFailedToStart([
        "in_progress",
        "failed_to_start",
        "failed_to_start",
      ]),
    ).toBe(0);
  });
});
