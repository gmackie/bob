import { describe, it, expect, vi, beforeEach } from "vitest";
import { HeartbeatSender } from "../heartbeat-sender.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("HeartbeatSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });

  it("sends heartbeat with agent types and repos", async () => {
    const sender = new HeartbeatSender({
      apiUrl: "http://localhost:3000",
      apiKey: "bob_test123",
      workspaceId: "ws-123",
    });

    await sender.send({
      agentTypes: ["claude"],
      forgeAvailable: true,
      repos: [
        {
          name: "bob",
          path: "/dev/bob",
          isGit: true,
          remoteUrl: "https://gitea.forge.gmac.io/mackieg/bob.git",
          branch: "main",
          dirty: false,
          buildSystem: "node",
          forgeAppId: "abc123",
        },
      ],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/api/v1/workspaces/ws-123/heartbeat");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.agentTypes).toEqual(["claude"]);
    expect(body.repos).toHaveLength(1);
    expect(body.forgeAvailable).toBe(true);
  });

  it("handles API errors without throwing", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("Internal error") });

    const sender = new HeartbeatSender({
      apiUrl: "http://localhost:3000",
      apiKey: "bob_test123",
      workspaceId: "ws-123",
    });

    // Should not throw
    await sender.send({ agentTypes: [], forgeAvailable: false, repos: [] });
  });
});
