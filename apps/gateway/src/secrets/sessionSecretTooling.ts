import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface PrepareSessionSecretToolingInput {
  sessionId: string;
  gatewayUrl: string;
  brokerToken: string;
  manifest?: unknown[];
  baseEnv?: Record<string, string | undefined>;
  wrapperRoot?: string;
  cliInvocation?: string[];
}

function shellQuote(part: string) {
  if (/^[A-Za-z0-9_./:-]+$/.test(part)) {
    return part;
  }

  return `'${part.replace(/'/g, `'\\''`)}'`;
}

function resolveDefaultCliInvocation() {
  const currentFile = fileURLToPath(import.meta.url);
  const extension = path.extname(currentFile);
  const cliPath = path.join(
    path.dirname(currentFile),
    `sessionSecretCli${extension}`,
  );

  if (extension === ".ts") {
    return [process.execPath, "--import", "tsx", cliPath];
  }

  return [process.execPath, cliPath];
}

export async function prepareSessionSecretTooling(
  input: PrepareSessionSecretToolingInput,
) {
  const wrapperRoot =
    input.wrapperRoot ?? path.join(tmpdir(), "bob-session-tools");
  const wrapperDir = path.join(wrapperRoot, input.sessionId);
  const wrapperPath = path.join(wrapperDir, "bob-session-secret");
  const cliInvocation = input.cliInvocation ?? resolveDefaultCliInvocation();
  const existingPath =
    input.baseEnv?.PATH ?? process.env.PATH ?? "";

  await mkdir(wrapperDir, { recursive: true });
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec ${cliInvocation.map(shellQuote).join(" ")} "$@"\n`,
    "utf8",
  );
  await chmod(wrapperPath, 0o755);

  return {
    BOB_SESSION_ID: input.sessionId,
    ...(process.env.BOB_API_URL ? { BOB_API_URL: process.env.BOB_API_URL } : {}),
    BOB_SECRET_BROKER_URL: input.gatewayUrl,
    BOB_SECRET_BROKER_TOKEN: input.brokerToken,
    BOB_SESSION_SECRET_MANIFEST: JSON.stringify(input.manifest ?? []),
    BOB_SECRET_TOOL_HELP:
      "Use bob-session-secret exec --handle <handle> --template <template-id> [--arg key=value]",
    PATH: existingPath ? `${wrapperDir}:${existingPath}` : wrapperDir,
  };
}
