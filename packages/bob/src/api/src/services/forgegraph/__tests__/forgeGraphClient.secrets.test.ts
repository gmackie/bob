import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForgeGraphClient } from "../forgeGraphClient.js";

global.fetch = vi.fn();

describe("ForgeGraphClient secret methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts a deploy secret", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ref: "fg://secret/staging/github-token" }),
    });

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
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          key: "GITHUB_TOKEN",
          ref: "fg://secret/staging/github-token",
          updatedAt: "2026-03-30T00:00:00.000Z",
        },
      ],
    });

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
