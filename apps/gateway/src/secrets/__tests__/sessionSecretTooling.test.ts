import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareSessionSecretTooling } from "../sessionSecretTooling.js";

const tempRoots: string[] = [];

describe("prepareSessionSecretTooling", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async (root) => {
        await import("node:fs/promises").then(({ rm }) =>
          rm(root, { recursive: true, force: true }),
        );
      }),
    );
  });

  it("creates a session-local wrapper command and injects broker env", async () => {
    const wrapperRoot = await mkdtemp(path.join(tmpdir(), "bob-secret-tooling-"));
    tempRoots.push(wrapperRoot);

    const env = await prepareSessionSecretTooling({
      sessionId: "session-123",
      gatewayUrl: "http://127.0.0.1:3002/session/secrets/execute",
      brokerToken: "broker-token",
      wrapperRoot,
      cliInvocation: ["/usr/local/bin/node", "/tmp/sessionSecretCli.js"],
      baseEnv: {
        PATH: "/usr/bin",
      },
    });

    const wrapperDir = env.PATH.split(":")[0]!;
    const wrapperPath = path.join(wrapperDir, "bob-session-secret");
    const wrapperContents = await readFile(wrapperPath, "utf8");

    expect(env.BOB_SECRET_BROKER_URL).toBe(
      "http://127.0.0.1:3002/session/secrets/execute",
    );
    expect(env.BOB_SECRET_BROKER_TOKEN).toBe("broker-token");
    expect(env.PATH).toContain("/usr/bin");
    expect(wrapperContents).toContain('exec /usr/local/bin/node /tmp/sessionSecretCli.js "$@"');
  });
});
