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
      apiUrl: "https://planning.example.internal/api",
      baseUrl: "https://planning.example.internal",
      apiKey: "planning-api-key",
    });
  });

  it("falls back to legacy remote API env names", () => {
    expect(
      getPlanningRemoteConfig({
        PLANNING_API_URL: "https://planning-api.example.internal/v1",
        PLANNING_URL: "https://planning.example.internal",
        PLANNING_API_KEY: "planning-api-key",
      }),
    ).toEqual({
      apiUrl: "https://planning-api.example.internal/v1",
      baseUrl: "https://planning.example.internal",
      apiKey: "planning-api-key",
    });
  });

  it("falls back to legacy remote API env names", () => {
    expect(
      getPlanningRemoteConfig({
        KANBANGER_API_URL: "https://legacy-api.example.internal/v1",
        KANBANGER_URL: "https://legacy.example.internal",
        KANBANGER_API_KEY: "legacy-api-key",
      }),
    ).toEqual({
      apiUrl: "https://legacy-api.example.internal/v1",
      baseUrl: "https://legacy.example.internal",
      apiKey: "legacy-api-key",
    });
  });
});
