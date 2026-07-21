import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForgeGraphClient } from "../forgeGraphClient.js";

// Typed to the real `fetch` signature so every mockResolvedValueOnce fixture
// below is checked against Response's shape. Fixtures only implement the
// subset of Response that ForgeGraphClient actually reads (ok/json), so each
// literal is cast through `as Response` at its call site.
const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock;

describe("ForgeGraphClient secret methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts a deploy secret", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ref: "fg://secret/staging/github-token" }),
    } as Response);

    const client = new ForgeGraphClient({
      baseUrl: "https://forge.example.com",
      apiToken: "fg-token",
      timeoutMs: 1000,
    });

    const result = await client.upsertDeploySecret({
      projectId: "project-1",
      environment: "staging",
      key: "GITHUB_TOKEN",
      value: "ghp_secret",
    });

    expect(result).toEqual({ ref: "fg://secret/staging/github-token" });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://forge.example.com/api/fg/deploy-secrets",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          environment: "staging",
          key: "GITHUB_TOKEN",
          value: "ghp_secret",
        }),
      }),
    );
  });

  it("lists deploy secrets", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            key: "GITHUB_TOKEN",
            ref: "fg://secret/staging/github-token",
            updatedAt: "2026-03-30T00:00:00.000Z",
          },
        ]),
    } as Response);

    const client = new ForgeGraphClient({
      baseUrl: "https://forge.example.com",
      apiToken: "fg-token",
      timeoutMs: 1000,
    });

    const result = await client.listDeploySecrets({
      projectId: "project-1",
      environment: "staging",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("GITHUB_TOKEN");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://forge.example.com/api/fg/deploy-secrets?projectId=project-1&environment=staging",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });
});
