import { describe, expect, it, vi } from "vitest";

import { SessionSecretBroker } from "../sessionSecretBroker.js";

describe("SessionSecretBroker", () => {
  it("issues a session token and executes an allowlisted template", async () => {
    const recordUsage = vi.fn();
    const runner = vi.fn(async () => ({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
    }));

    const broker = new SessionSecretBroker({
      secretLookup: async (sessionId, handle) => {
        expect(sessionId).toBe("session-1");
        expect(handle).toBe("github-token");
        return {
          id: "secret-1",
          handle,
          value: "ghp_secret",
          policy: { allowedTemplates: ["gh-api"], redactOutput: true },
        };
      },
      runner,
      recordUsage,
      signingKey: "test-broker-signing-key",
    });

    const token = broker.issueToken({ sessionId: "session-1" });
    const result = await broker.executeTemplate({
      token,
      handle: "github-token",
      templateId: "gh-api",
      args: { path: "/user" },
    });

    expect(result.exitCode).toBe(0);
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["gh", "api", "/user"],
        env: expect.objectContaining({
          GITHUB_TOKEN: "ghp_secret",
        }),
      }),
    );
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        secretId: "secret-1",
        templateId: "gh-api",
        exitCode: 0,
      }),
    );
  });

  it("rejects unknown secret handles", async () => {
    const broker = new SessionSecretBroker({
      secretLookup: async () => null,
      runner: vi.fn(),
      recordUsage: vi.fn(),
      signingKey: "test-broker-signing-key",
    });

    const token = broker.issueToken({ sessionId: "session-1" });

    await expect(
      broker.executeTemplate({
        token,
        handle: "missing-handle",
        templateId: "gh-api",
        args: { path: "/user" },
      }),
    ).rejects.toThrow(/handle/i);
  });

  it("rejects arbitrary shell templates even if they appear in the registry", async () => {
    const broker = new SessionSecretBroker({
      secretLookup: async () => ({
        id: "secret-1",
        handle: "github-token",
        value: "ghp_secret",
        policy: { allowedTemplates: ["shell-unsafe"], redactOutput: true },
      }),
      runner: vi.fn(),
      recordUsage: vi.fn(),
      signingKey: "test-broker-signing-key",
      templates: {
        "shell-unsafe": {
          kind: "env-fixed",
          command: ["bash", "-lc", "echo $SECRET"],
          env: {
            SECRET: "{{secret}}",
          },
        },
      },
    });

    const token = broker.issueToken({ sessionId: "session-1" });

    await expect(
      broker.executeTemplate({
        token,
        handle: "github-token",
        templateId: "shell-unsafe",
        args: {},
      }),
    ).rejects.toThrow(/unsafe/i);
  });

  it("redacts secret material from command output", async () => {
    const broker = new SessionSecretBroker({
      secretLookup: async () => ({
        id: "secret-1",
        handle: "github-token",
        value: "ghp_secret",
        policy: { allowedTemplates: ["gh-api"], redactOutput: true },
      }),
      runner: vi.fn(async () => ({
        stdout: "token=ghp_secret",
        stderr: "err ghp_secret",
        exitCode: 0,
        durationMs: 8,
      })),
      recordUsage: vi.fn(),
      signingKey: "test-broker-signing-key",
    });

    const token = broker.issueToken({ sessionId: "session-1" });
    const result = await broker.executeTemplate({
      token,
      handle: "github-token",
      templateId: "gh-api",
      args: { path: "/user" },
    });

    expect(result.stdout).toBe("token=***");
    expect(result.stderr).toBe("err ***");
  });

  it("enforces per-template arg prefix policies", async () => {
    const broker = new SessionSecretBroker({
      secretLookup: async () => ({
        id: "secret-1",
        handle: "github-token",
        value: "ghp_secret",
        policy: {
          allowedTemplates: ["gh-api"],
          redactOutput: true,
          templatePolicies: {
            "gh-api": {
              allowedArgPrefixes: {
                path: ["/repos/acme/"],
              },
            },
          },
        },
      }),
      runner: vi.fn(),
      recordUsage: vi.fn(),
      signingKey: "test-broker-signing-key",
    });

    const token = broker.issueToken({ sessionId: "session-1" });

    await expect(
      broker.executeTemplate({
        token,
        handle: "github-token",
        templateId: "gh-api",
        args: { path: "/user" },
      }),
    ).rejects.toThrow(/path/i);
  });

  it("rejects secrets that exceed max uses", async () => {
    const broker = new SessionSecretBroker({
      secretLookup: async () => ({
        id: "secret-1",
        handle: "github-token",
        value: "ghp_secret",
        usageCount: 2,
        policy: {
          allowedTemplates: ["gh-api"],
          redactOutput: true,
          maxUses: 2,
        },
      }),
      runner: vi.fn(),
      recordUsage: vi.fn(),
      signingKey: "test-broker-signing-key",
    });

    const token = broker.issueToken({ sessionId: "session-1" });

    await expect(
      broker.executeTemplate({
        token,
        handle: "github-token",
        templateId: "gh-api",
        args: { path: "/user" },
      }),
    ).rejects.toThrow(/max uses/i);
  });
});
