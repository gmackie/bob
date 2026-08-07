import { realpath } from "node:fs/promises";

import type { AdapterCommand } from "@gmacko/ooda/agent-adapters";

function schemeString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export async function wrapInProcessSandbox(
  command: AdapterCommand,
  scratchPath: string,
  platform = process.platform,
): Promise<AdapterCommand> {
  if (platform !== "darwin") {
    throw new Error(
      `No fail-closed OODA agent-job process sandbox is configured for ${platform}`,
    );
  }
  const canonicalScratchPath = await realpath(scratchPath);
  const profile = [
    "(version 1)",
    "(allow default)",
    '(deny file-read* file-write* (subpath "/Users") (subpath "/Volumes"))',
    "(deny file-write*)",
    `(allow file-read* (subpath ${schemeString(canonicalScratchPath)}))`,
    `(allow file-write* (subpath ${schemeString(canonicalScratchPath)}) (literal \"/dev/null\"))`,
  ].join("\n");
  return {
    ...command,
    binary: "/usr/bin/sandbox-exec",
    args: ["-p", profile, "--", command.binary, ...command.args],
  };
}
