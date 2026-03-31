import { describe, expect, it, vi } from "vitest";

import { runSessionSecretCli } from "../sessionSecretCli.js";

describe("runSessionSecretCli", () => {
  it("posts the broker request and relays stdout and stderr", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        stdout: "ok\n",
        stderr: "warn\n",
        exitCode: 0,
      }),
    }));

    const exitCode = await runSessionSecretCli(
      [
        "exec",
        "--handle",
        "github-token",
        "--template",
        "gh-api",
        "--arg",
        "path=/user",
      ],
      {
        env: {
          BOB_SECRET_BROKER_URL: "http://127.0.0.1:3002/session/secrets/execute",
          BOB_SECRET_BROKER_TOKEN: "broker-token",
        },
        fetch: fetchMock as any,
        stdout,
        stderr,
      },
    );

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/session/secrets/execute",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          token: "broker-token",
          handle: "github-token",
          templateId: "gh-api",
          args: {
            path: "/user",
          },
        }),
      }),
    );
    expect(stdout).toHaveBeenCalledWith("ok\n");
    expect(stderr).toHaveBeenCalledWith("warn\n");
  });
});
