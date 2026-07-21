import fs from "node:fs";
import path from "node:path";

export type DesktopPaths = {
  readonly appRoot: string;
  readonly bobServerBin: string;
  readonly daemonBinDir: string;
  readonly serverCwd: string;
};

export function resolveDesktopPaths(options: {
  isPackaged: boolean;
  resourcesPath: string;
  electronDir: string;
}): DesktopPaths {
  if (options.isPackaged) {
    const resources = options.resourcesPath;
    return {
      appRoot: resources,
      bobServerBin: path.join(resources, "bob-server", "dist", "bin.js"),
      daemonBinDir: path.join(resources, "bin"),
      serverCwd: path.join(resources, "bob-server"),
    };
  }

  const appRoot = path.resolve(options.electronDir, "../../..");
  return {
    appRoot,
    bobServerBin: path.join(appRoot, "apps", "bob-server", "dist", "bin.js"),
    daemonBinDir: path.resolve(options.electronDir, "..", "resources", "bin"),
    serverCwd: appRoot,
  };
}

export type DaemonBinaryResolution =
  | { readonly kind: "found"; readonly path: string }
  | { readonly kind: "unsupported-platform"; readonly platform: string }
  | { readonly kind: "missing"; readonly expectedPath: string };

export function daemonBinaryBasename(
  platform: NodeJS.Platform,
  arch: string,
): string | null {
  const normalizedArch = arch === "x64" ? "amd64" : arch;
  if (platform === "darwin") {
    return `bob-darwin-${normalizedArch}`;
  }
  if (platform === "linux") {
    return `bob-linux-${normalizedArch}`;
  }
  if (platform === "win32") {
    return `bob-windows-${normalizedArch}.exe`;
  }
  return null;
}

export function resolveDaemonBinaryPath(options: {
  platform: NodeJS.Platform;
  arch: string;
  binDir: string;
}): DaemonBinaryResolution {
  const basename = daemonBinaryBasename(options.platform, options.arch);
  if (!basename) {
    return {
      kind: "unsupported-platform",
      platform: options.platform,
    };
  }

  const binPath = path.join(options.binDir, basename);
  if (!fs.existsSync(binPath)) {
    return {
      kind: "missing",
      expectedPath: binPath,
    };
  }

  return {
    kind: "found",
    path: binPath,
  };
}
