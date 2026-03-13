import { describe, expect, it } from "vitest";

import { getPlanningRemoteConfig } from "../remote-config";

describe("planning remote config", () => {
  it("prefers planning env names for remote API access", () => {
    expect(
      getPlanningRemoteConfig({
        PLANNING_URL: "https://planning.example.internal",
        PLANNING_API_KEY: "planning-api-key",
        KANBANGER_URL: "https://legacy.example.internal",
        KANBANGER_API_KEY: "legacy-api-key",
      }),
    ).toEqual({
      baseUrl: "https://planning.example.internal",
      apiKey: "planning-api-key",
    });
  });

  it("falls back to legacy remote API env names", () => {
    expect(
      getPlanningRemoteConfig({
        KANBANGER_URL: "https://legacy.example.internal",
        KANBANGER_API_KEY: "legacy-api-key",
      }),
    ).toEqual({
      baseUrl: "https://legacy.example.internal",
      apiKey: "legacy-api-key",
    });
  });
});
