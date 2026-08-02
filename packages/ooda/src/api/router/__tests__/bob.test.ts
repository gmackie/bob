import { describe, it, expect } from "vitest";

import { resolveBobDispatchConfig } from "../bob-config.js";

describe("resolveBobDispatchConfig", () => {
  it("returns config when all three vars are set, trimming trailing slashes", () => {
    expect(
      resolveBobDispatchConfig({
        BOB_API_URL: "https://bob.blder.bot/",
        BOB_API_KEY: "bob_live_x",
        BOB_WORKSPACE_ID: "ws-1",
      }),
    ).toEqual({
      apiUrl: "https://bob.blder.bot",
      apiKey: "bob_live_x",
      workspaceId: "ws-1",
    });
  });

  // Dark until configured: any missing/blank var -> null -> PRECONDITION_FAILED.
  it("returns null when any var is missing or blank", () => {
    const full = {
      BOB_API_URL: "https://bob",
      BOB_API_KEY: "k",
      BOB_WORKSPACE_ID: "w",
    };
    expect(resolveBobDispatchConfig({})).toBeNull();
    expect(resolveBobDispatchConfig({ ...full, BOB_API_URL: undefined })).toBeNull();
    expect(resolveBobDispatchConfig({ ...full, BOB_API_KEY: "  " })).toBeNull();
    expect(resolveBobDispatchConfig({ ...full, BOB_WORKSPACE_ID: "" })).toBeNull();
  });
});
