import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { killProcessTree } from "./process-tree.js";

function command(
  cwd: string,
  program: string,
  args: string[],
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      killProcessTree(child, "SIGTERM");
      escalation = setTimeout(() => killProcessTree(child, "SIGKILL"), 5000);
    };
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (signal.aborted) killProcessTree(child, "SIGKILL");
      if (escalation) clearTimeout(escalation);
      signal.removeEventListener("abort", stop);
      if (signal.aborted)
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Session cancelled"),
        );
      else if (code !== 0)
        reject(Error(`${program} workspace preparation failed: ${stderr}`));
      else resolve(stdout.trim());
    });
  });
}
/** Never runs an agent in the user's checkout; unresolved paths fail closed. */
export async function prepareWorkspace(
  source: string,
  sessionId: string,
  branch: string | undefined,
  signal: AbortSignal,
  base = join(homedir(), ".config", "superpowers", "worktrees", "bob-sessions"),
): Promise<string> {
  signal.throwIfAborted();
  if (!source || !statSync(source).isDirectory())
    throw Error("Session repository directory is required");
  const root = realpathSync(source);
  let jjRoot = root;
  while (!existsSync(join(jjRoot, ".jj")) && dirname(jjRoot) !== jjRoot)
    jjRoot = dirname(jjRoot);
  const isJj = existsSync(join(jjRoot, ".jj"));
  if (!isJj)
    await command(root, "git", ["rev-parse", "--show-toplevel"], signal);
  const id = createHash("sha256")
    .update(`${root}\0${sessionId}`)
    .digest("hex")
    .slice(0, 24);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const target = join(base, id);
  if (existsSync(target))
    throw Error("Session workspace already exists; explicit recovery required");
  if (isJj) {
    await command(
      root,
      "jj",
      [
        "workspace",
        "add",
        "--name",
        `bob-${id}`,
        "--revision",
        branch ?? "@",
        target,
      ],
      signal,
    );
  } else {
    if (branch) {
      await command(
        root,
        "git",
        ["check-ref-format", "--branch", branch],
        signal,
      );
    }
    // A session gets its own named branch when none was supplied. Existing
    // branches must be exclusively available; Git refuses branches checked out
    // elsewhere rather than detaching and silently committing off the advertised branch.
    let existing = false;
    if (branch) {
      try {
        await command(
          root,
          "git",
          ["show-ref", "--verify", `refs/heads/${branch}`],
          signal,
        );
        existing = true;
      } catch {
        signal.throwIfAborted();
      }
    }
    const args = existing
      ? ["worktree", "add", target, branch ?? "HEAD"]
      : [
          "worktree",
          "add",
          "-b",
          branch ?? `bob/session-${id}`,
          target,
          "HEAD",
        ];
    await command(root, "git", args, signal);
  }
  signal.throwIfAborted();
  return target;
}
