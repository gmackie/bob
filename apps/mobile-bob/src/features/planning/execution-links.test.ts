import { describe, expect, it } from "vitest";

import { buildHeadlessSessionDestination } from "./execution-links";

describe("execution links", () => {
  it("builds a headless chat destination for a linked task run", () => {
    expect(
      buildHeadlessSessionDestination("session-42", "https://builder.example.com/"),
    ).toBe("https://builder.example.com/chat?mode=headless&session=session-42");
  });

  it("encodes session identifiers in the headless chat destination", () => {
    expect(
      buildHeadlessSessionDestination("session/needs review", "https://builder.example.com"),
    ).toBe(
      "https://builder.example.com/chat?mode=headless&session=session%2Fneeds%20review",
    );
  });
});
