import { describe, expect, it } from "vitest";

import { buildCliCommand } from "../bob-gateway";

describe("Bob gateway CLI commands", () => {
  it("invokes Cursor Agent explicitly instead of the generic agent binary", () => {
    expect(
      buildCliCommand("cursor", "Reply with exactly CURSOR_OK", {
        personaConfig: { model: "cursor-model" },
      }),
    ).toEqual({
      command: "cursor-agent",
      args: [
        "--print",
        "--yolo",
        "--trust",
        "--model",
        "cursor-model",
        "Reply with exactly CURSOR_OK",
      ],
    });
  });
});
