import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { prepareWorkspace } from "./workspace.js";

it("parallel session workspaces preserve source dirt and never reset a branch", async () => {
  const root = mkdtempSync(join(tmpdir(), "bob-workspace-"));
  const source = join(root, "source");
  try {
    execFileSync("git", ["init", source]);
    execFileSync("git", [
      "-C",
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    writeFileSync(join(source, "dirty"), "user");
    const a = await prepareWorkspace(
      source,
      "one",
      undefined,
      new AbortController().signal,
      join(root, "sessions"),
    );
    const b = await prepareWorkspace(
      source,
      "two",
      undefined,
      new AbortController().signal,
      join(root, "sessions"),
    );
    expect(a).not.toBe(b);
    expect(readFileSync(join(source, "dirty"), "utf8")).toBe("user");
    writeFileSync(join(a, "agent"), "one");
    expect(() => readFileSync(join(b, "agent"))).toThrow();
    await expect(
      prepareWorkspace(
        "/does-not-exist",
        "x",
        undefined,
        new AbortController().signal,
        root,
      ),
    ).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
