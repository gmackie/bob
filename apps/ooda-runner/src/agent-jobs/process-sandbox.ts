import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import {
  delimiter,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import type { AdapterCommand } from "@gmacko/ooda/agent-adapters";

function schemeString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

type ProcessSandboxOptions = {
  platform?: NodeJS.Platform;
  environment?: Record<string, string | undefined>;
  linuxSandboxBinary?: string;
  readOnlyPaths?: string[];
  writablePaths?: string[];
};

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

async function accessible(
  path: string,
  mode = constants.R_OK,
): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(
  binary: string,
  cwd: string,
  environment: Record<string, string | undefined>,
): Promise<string> {
  const candidates = binary.includes(sep)
    ? [isAbsolute(binary) ? binary : resolve(cwd, binary)]
    : (environment.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((entry) => resolve(entry, binary));
  for (const candidate of candidates) {
    if (await accessible(candidate, constants.X_OK)) return realpath(candidate);
  }
  throw new Error(
    `Agent executable is not available to the sandbox: ${binary}`,
  );
}

function parentDirectories(path: string): string[] {
  const parents: string[] = [];
  for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) {
    parents.push(parent);
  }
  return parents.reverse();
}

async function linuxSandboxArgs(input: {
  command: AdapterCommand;
  scratchPath: string;
  environment: Record<string, string | undefined>;
  readOnlyPaths: string[];
  writablePaths: string[];
}): Promise<string[]> {
  const executable = await resolveExecutable(
    input.command.binary,
    input.command.cwd,
    { ...input.environment, ...input.command.env },
  );
  const systemMounts = (
    await Promise.all(
      ["/usr", "/bin", "/sbin", "/lib", "/lib64"].map(async (path) => ({
        path,
        available: await accessible(path),
      })),
    )
  ).filter(({ available }) => available);
  const systemConfig = (
    await Promise.all(
      [
        "/etc/ssl/certs",
        "/etc/ca-certificates",
        "/etc/resolv.conf",
        "/etc/hosts",
        "/etc/nsswitch.conf",
        "/etc/gai.conf",
        "/etc/services",
        "/etc/protocols",
        "/etc/passwd",
        "/etc/group",
        "/etc/localtime",
      ].map(async (path) => ({ path, available: await accessible(path) })),
    )
  ).filter(({ available }) => available);
  const executableIsSystem = systemMounts.some(({ path }) =>
    isInside(path, executable),
  );
  const sandboxExecutable = executableIsSystem
    ? executable
    : "/run/ooda/agent-cli";
  const namespaceParents = [
    input.scratchPath,
    ...input.writablePaths,
    ...input.readOnlyPaths,
  ]
    .flatMap(parentDirectories)
    .filter((path, index, paths) => paths.indexOf(path) === index);

  return [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--cap-drop",
    "ALL",
    ...systemMounts.flatMap(({ path }) => ["--ro-bind", path, path]),
    "--dir",
    "/etc",
    ...systemConfig.flatMap(({ path }) => ["--ro-bind", path, path]),
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    ...namespaceParents.flatMap((path) => ["--dir", path]),
    "--bind",
    input.scratchPath,
    input.scratchPath,
    ...input.writablePaths.flatMap((path) => ["--bind", path, path]),
    ...input.readOnlyPaths.flatMap((path) => ["--ro-bind", path, path]),
    ...(!executableIsSystem
      ? [
          "--dir",
          "/run",
          "--dir",
          "/run/ooda",
          "--ro-bind",
          executable,
          sandboxExecutable,
        ]
      : []),
    "--chdir",
    input.command.cwd,
    "--",
    sandboxExecutable,
    ...input.command.args,
  ];
}

export async function wrapInProcessSandbox(
  command: AdapterCommand,
  scratchPath: string,
  options: ProcessSandboxOptions = {},
): Promise<AdapterCommand> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(
      `No fail-closed OODA agent-job process sandbox is configured for ${platform}`,
    );
  }
  const canonicalScratchPath = await realpath(scratchPath);
  const canonicalCwd = await realpath(command.cwd);
  if (!isInside(canonicalScratchPath, canonicalCwd)) {
    throw new Error(
      "Agent command working directory escapes its scratch sandbox",
    );
  }
  const canonicalReadOnlyPaths = await Promise.all(
    (options.readOnlyPaths ?? []).map((path) => realpath(path)),
  );
  const canonicalWritablePaths = await Promise.all(
    (options.writablePaths ?? []).map((path) => realpath(path)),
  );
  for (const path of canonicalReadOnlyPaths) {
    if (
      isInside(canonicalScratchPath, path) ||
      isInside(path, canonicalScratchPath)
    ) {
      throw new Error(
        "Agent read-only mount must be outside its artifact workspace",
      );
    }
  }
  for (const path of canonicalWritablePaths) {
    if (
      isInside(canonicalScratchPath, path) ||
      isInside(path, canonicalScratchPath)
    ) {
      throw new Error(
        "Agent writable mount must be outside its artifact workspace",
      );
    }
  }

  if (platform === "linux") {
    const binary = options.linuxSandboxBinary ?? "/usr/bin/bwrap";
    if (!(await accessible(binary, constants.X_OK))) {
      throw new Error(`Linux agent-job sandbox is unavailable: ${binary}`);
    }
    return {
      ...command,
      binary,
      args: await linuxSandboxArgs({
        command: { ...command, cwd: canonicalCwd },
        scratchPath: canonicalScratchPath,
        environment: options.environment ?? process.env,
        readOnlyPaths: canonicalReadOnlyPaths,
        writablePaths: canonicalWritablePaths,
      }),
      cwd: canonicalCwd,
    };
  }

  const profile = [
    "(version 1)",
    "(allow default)",
    '(deny file-read* file-write* (subpath "/Users") (subpath "/Volumes"))',
    "(deny file-write*)",
    `(allow file-read* (subpath ${schemeString(canonicalScratchPath)}))`,
    ...canonicalReadOnlyPaths.map(
      (path) => `(allow file-read* (subpath ${schemeString(path)}))`,
    ),
    `(allow file-write* (subpath ${schemeString(canonicalScratchPath)}) (literal \"/dev/null\"))`,
    ...canonicalWritablePaths.map(
      (path) =>
        `(allow file-read* file-write* (subpath ${schemeString(path)}))`,
    ),
    ...canonicalReadOnlyPaths.map(
      (path) => `(deny file-write* (literal ${schemeString(path)}))`,
    ),
  ].join("\n");
  return {
    ...command,
    binary: "/usr/bin/sandbox-exec",
    args: ["-p", profile, "--", command.binary, ...command.args],
    cwd: canonicalCwd,
  };
}
