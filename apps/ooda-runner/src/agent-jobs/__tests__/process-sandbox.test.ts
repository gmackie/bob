import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { wrapInProcessSandbox } from "../process-sandbox";

function nativeSandboxCanLaunch(): boolean {
  if (process.platform === "darwin") return true;
  if (process.platform !== "linux") return false;
  return (
    spawnSync(
      "/usr/bin/bwrap",
      [
        "--die-with-parent",
        "--ro-bind",
        "/usr",
        "/usr",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--",
        "/usr/bin/true",
      ],
      { timeout: 2_000 },
    ).status === 0
  );
}

describe.runIf(nativeSandboxCanLaunch())("agent-job process sandbox", () => {
  it("allows scratch writes and denies user-file reads and writes outside the disposable root", async () => {
    const scratch = join(
      tmpdir(),
      `ooda-process-sandbox-${crypto.randomUUID()}`,
    );
    const outside = join(
      homedir(),
      `ooda-process-outside-${crypto.randomUUID()}`,
    );
    await Promise.all([
      mkdir(scratch, { recursive: true, mode: 0o700 }),
      mkdir(outside, { recursive: true, mode: 0o700 }),
    ]);
    await writeFile(join(outside, "secret"), "must-not-leak", {
      mode: 0o600,
    });
    try {
      const command = await wrapInProcessSandbox(
        {
          binary: "/bin/sh",
          args: [
            "-c",
            [
              "set -e",
              `printf allowed > ${JSON.stringify(join(scratch, "inside"))}`,
              `if leaked=$(cat ${JSON.stringify(join(outside, "secret"))} 2>/dev/null); then printf %s "$leaked" > ${JSON.stringify(join(scratch, "leaked"))}; exit 70; fi`,
              `if printf denied > ${JSON.stringify(join(outside, "outside"))} 2>/dev/null; then exit 71; fi`,
            ].join("; "),
          ],
          cwd: scratch,
        },
        scratch,
      );
      const result = spawnSync(command.binary, command.args, {
        cwd: command.cwd,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      await expect(access(join(scratch, "inside"))).resolves.toBeUndefined();
      await expect(access(join(scratch, "leaked"))).rejects.toMatchObject({
        code: "ENOENT",
      });
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

  it("keeps disposable CLI state writable while credential files stay read-only", async () => {
    const scratch = join(
      tmpdir(),
      `ooda-process-sandbox-${crypto.randomUUID()}`,
    );
    const runtimeHome = join(
      tmpdir(),
      `ooda-runtime-home-${crypto.randomUUID()}`,
    );
    const credential = join(runtimeHome, ".codex", "auth.json");
    await Promise.all([
      mkdir(scratch, { recursive: true, mode: 0o700 }),
      mkdir(join(runtimeHome, ".codex"), { recursive: true, mode: 0o700 }),
    ]);
    await writeFile(credential, "subscription-token", { mode: 0o600 });

    try {
      const command = await wrapInProcessSandbox(
        {
          binary: "/bin/sh",
          args: [
            "-c",
            [
              "set -e",
              `printf state > ${JSON.stringify(
                join(runtimeHome, ".codex", "state.json"),
              )}`,
              `test "$(cat ${JSON.stringify(credential)})" = subscription-token`,
              `if printf replaced > ${JSON.stringify(credential)} 2>/dev/null; then exit 72; fi`,
            ].join("; "),
          ],
          cwd: scratch,
        },
        scratch,
        {
          writablePaths: [runtimeHome],
          readOnlyPaths: [credential],
        },
      );
      const result = spawnSync(command.binary, command.args, {
        cwd: command.cwd,
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(0);
      await expect(
        access(join(runtimeHome, ".codex", "state.json")),
      ).resolves.toBeUndefined();
      await expect(readFile(credential, "utf8")).resolves.toBe(
        "subscription-token",
      );
    } finally {
      await Promise.all([
        rm(scratch, { recursive: true, force: true }),
        rm(runtimeHome, { recursive: true, force: true }),
      ]);
    }
  });
});

describe("agent-job process sandbox contract", () => {
  it("builds the Linux namespace command independently of a host Bubblewrap install", async () => {
    const scratch = join(
      tmpdir(),
      `ooda-process-sandbox-${crypto.randomUUID()}`,
    );
    const credentialHome = join(
      tmpdir(),
      `ooda-credential-home-${crypto.randomUUID()}`,
    );
    const credential = join(credentialHome, ".codex", "auth.json");
    await Promise.all([
      mkdir(scratch, { recursive: true, mode: 0o700 }),
      mkdir(join(credentialHome, ".codex"), {
        recursive: true,
        mode: 0o700,
      }),
    ]);
    await writeFile(credential, "subscription-token", { mode: 0o600 });
    try {
      const command = await wrapInProcessSandbox(
        { binary: "/bin/sh", args: ["-c", "true"], cwd: scratch },
        scratch,
        {
          platform: "linux",
          linuxSandboxBinary: "/usr/bin/true",
          environment: { PATH: "/usr/bin:/bin" },
          readOnlyPaths: [credential],
          writablePaths: [credentialHome],
        },
      );

      expect(command.binary).toBe("/usr/bin/true");
      expect(command.args).toEqual(
        expect.arrayContaining([
          "--die-with-parent",
          "--new-session",
          "--unshare-user",
          "--unshare-pid",
          "--cap-drop",
          "ALL",
        ]),
      );
      const writableMount = command.args.lastIndexOf(
        await realpath(credentialHome),
      );
      const credentialMount = command.args.lastIndexOf(
        await realpath(credential),
      );
      expect(command.args.slice(writableMount - 1, writableMount + 1)).toEqual([
        await realpath(credentialHome),
        await realpath(credentialHome),
      ]);
      expect(command.args[writableMount - 2]).toBe("--bind");
      expect(
        command.args.slice(credentialMount - 1, credentialMount + 1),
      ).toEqual([await realpath(credential), await realpath(credential)]);
      expect(command.args[credentialMount - 2]).toBe("--ro-bind");
      expect(credentialMount).toBeGreaterThan(writableMount);
    } finally {
      await Promise.all([
        rm(scratch, { recursive: true, force: true }),
        rm(credentialHome, { recursive: true, force: true }),
      ]);
    }
  });

  it("fails closed for unsupported operating systems", async () => {
    const scratch = join(
      tmpdir(),
      `ooda-process-sandbox-${crypto.randomUUID()}`,
    );
    await mkdir(scratch, { recursive: true, mode: 0o700 });
    try {
      await expect(
        wrapInProcessSandbox(
          { binary: "/bin/sh", args: [], cwd: scratch },
          scratch,
          { platform: "win32" },
        ),
      ).rejects.toThrow(
        "No fail-closed OODA agent-job process sandbox is configured for win32",
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
