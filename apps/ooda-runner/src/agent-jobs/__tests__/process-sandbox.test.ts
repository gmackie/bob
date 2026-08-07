import { spawnSync } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { wrapInProcessSandbox } from "../process-sandbox";

describe.runIf(process.platform === "darwin")(
  "agent-job process sandbox",
  () => {
    it("allows scratch writes and denies writes outside the disposable root", async () => {
      const scratch = join(
        tmpdir(),
        `ooda-process-sandbox-${crypto.randomUUID()}`,
      );
      const outside = join(
        tmpdir(),
        `ooda-process-outside-${crypto.randomUUID()}`,
      );
      await Promise.all([
        mkdir(scratch, { recursive: true, mode: 0o700 }),
        mkdir(outside, { recursive: true, mode: 0o700 }),
      ]);
      try {
        const command = await wrapInProcessSandbox(
          {
            binary: "/bin/sh",
            args: [
              "-c",
              `set -e; printf allowed > ${JSON.stringify(join(scratch, "inside"))}; printf denied > ${JSON.stringify(join(outside, "outside"))}`,
            ],
            cwd: scratch,
          },
          scratch,
        );
        const result = spawnSync(command.binary, command.args, {
          cwd: command.cwd,
          encoding: "utf8",
        });

        expect(result.status).not.toBe(0);
        await expect(access(join(scratch, "inside"))).resolves.toBeUndefined();
        await expect(access(join(outside, "outside"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await Promise.all([
          rm(scratch, { recursive: true, force: true }),
          rm(outside, { recursive: true, force: true }),
        ]);
      }
    });
  },
);
