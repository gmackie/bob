import { describe, expect, it } from "vitest";

import { getPlanningRemoteConfig } from "../remote-config";

describe("planning remote config", () => {
  it("prefers planning env names for remote API access", () => {
    expect(
      getPlanningRemoteConfig({
        PLANNING_URL: "https://planning.example.internal",
        PLANNING_API_KEY: "planning-api-key",
      }),
    ).toEqual({
      apiUrl: "https://planning.example.internal/api",
      baseUrl: "https://planning.example.internal",
      apiKey: "planning-api-key",
    });
  });

  it("uses the explicit planning API URL when provided", () => {
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

  it("uses the default planning URL when no env is set", () => {
    expect(
      getPlanningRemoteConfig(),
    ).toEqual({
      apiUrl: "https://tasks.gmac.io/api",
      baseUrl: "https://tasks.gmac.io",
      apiKey: null,
    });
  });
});
