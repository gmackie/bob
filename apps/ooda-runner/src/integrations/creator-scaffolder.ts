import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  CreatorProjectScaffolder,
  CreatorScaffoldInput,
} from "@gmacko/ooda/integrations";

const executeFile = promisify(execFile);

export function createCreatorScaffolder(
  templatePath: string,
): CreatorProjectScaffolder {
  const setupScript = join(templatePath, "scripts", "setup.mjs");
  return async (input: CreatorScaffoldInput) => {
    const args = [
      setupScript,
      "--yes",
      "--out",
      input.projectPath,
      "--title",
      input.title,
      "--format",
      input.format,
      "--audience",
      input.audience,
      "--promise",
      input.promise,
      ...(input.fabforgeProject ? ["--project", input.fabforgeProject] : []),
    ];
    await executeFile(process.execPath, args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: process.env.LANG ?? "en_US.UTF-8",
        NODE_ENV: process.env.NODE_ENV ?? "production",
      },
    });
  };
}
