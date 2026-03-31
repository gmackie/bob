import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../types.js";
import { execSessionSecretTool, listSessionSecretsTool } from "../secrets.js";

function createContext(
  sessionId: string | null = "session-1",
): ToolContext & { mockCallTrpc: ReturnType<typeof vi.fn> } {
  const mockCallTrpc = vi.fn();
  return {
    sessionId,
    callTrpc: mockCallTrpc,
    mockCallTrpc,
  };
}

describe("secret tools", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("lists the non-secret manifest from environment metadata", async () => {
    vi.stubEnv(
      "BOB_SESSION_SECRET_MANIFEST",
      JSON.stringify([
        {
          handle: "github-token",
          label: "GitHub token",
          allowedTemplates: ["gh-api"],
          status: "active",
        },
      ]),
    );

    const result = await listSessionSecretsTool.handler({}, createContext());

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.secrets[0]).toEqual({
      handle: "github-token",
      label: "GitHub token",
      allowedTemplates: ["gh-api"],
      status: "active",
    });
  });

  it("executes via the broker endpoint without exposing plaintext", async () => {
    vi.stubEnv(
      "BOB_SECRET_BROKER_URL",
      "http://127.0.0.1:3002/session/secrets/execute",
    );
    vi.stubEnv("BOB_SECRET_BROKER_TOKEN", "broker-token");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        stdout: "ok\n",
        stderr: "",
        exitCode: 0,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await execSessionSecretTool.handler(
      {
        handle: "github-token",
        template: "gh-api",
        args: {
          path: "/user",
        },
      },
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/session/secrets/execute",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(result.isError).toBeFalsy();
    expect((result.content[0] as { text: string }).text).toContain("ok");
  });
});
