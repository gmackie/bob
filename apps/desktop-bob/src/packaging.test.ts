import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  daemonBinaryBasename,
  resolveDaemonBinaryPath,
  resolveDesktopPaths,
} from "./packaging.js";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bob-desktop-packaging-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDesktopPaths", () => {
  it("resolves monorepo paths in dev mode", () => {
    const electronDir = "/repo/apps/desktop-bob/dist-electron";
    const paths = resolveDesktopPaths({
      isPackaged: false,
      resourcesPath: "/unused",
      electronDir,
    });

    expect(paths.appRoot).toBe("/repo");
    expect(paths.bobServerBin).toBe("/repo/apps/bob-server/dist/bin.js");
    expect(paths.daemonBinDir).toBe("/repo/apps/desktop-bob/resources/bin");
    expect(paths.serverCwd).toBe("/repo");
  });

  it("resolves bundled resources in packaged mode", () => {
    const resources = "/Applications/Bob.app/Contents/Resources";
    const paths = resolveDesktopPaths({
      isPackaged: true,
      resourcesPath: resources,
      electronDir: "/unused",
    });

    expect(paths.bobServerBin).toBe(
      path.join(resources, "bob-server", "dist", "bin.js"),
    );
    expect(paths.daemonBinDir).toBe(path.join(resources, "bin"));
    expect(paths.serverCwd).toBe(path.join(resources, "bob-server"));
  });
});

describe("resolveDaemonBinaryPath", () => {
  it("maps platform and arch to the expected binary name", () => {
    expect(daemonBinaryBasename("darwin", "arm64")).toBe("bob-darwin-arm64");
    expect(daemonBinaryBasename("linux", "x64")).toBe("bob-linux-amd64");
    expect(daemonBinaryBasename("win32", "arm64")).toBe(
      "bob-windows-arm64.exe",
    );
    expect(daemonBinaryBasename("freebsd", "x64")).toBeNull();
  });

  it("returns found when the binary exists", () => {
    const binDir = makeTempDir();
    const binPath = path.join(binDir, "bob-linux-amd64");
    fs.writeFileSync(binPath, "");

    expect(
      resolveDaemonBinaryPath({
        platform: "linux",
        arch: "x64",
        binDir,
      }),
    ).toEqual({
      kind: "found",
      path: binPath,
    });
  });

  it("returns missing when the binary is absent", () => {
    const binDir = makeTempDir();
    const expectedPath = path.join(binDir, "bob-darwin-arm64");

    expect(
      resolveDaemonBinaryPath({
        platform: "darwin",
        arch: "arm64",
        binDir,
      }),
    ).toEqual({
      kind: "missing",
      expectedPath,
    });
  });

  it("returns unsupported-platform for unknown OS targets", () => {
    expect(
      resolveDaemonBinaryPath({
        platform: "freebsd",
        arch: "x64",
        binDir: "/tmp",
      }),
    ).toEqual({
      kind: "unsupported-platform",
      platform: "freebsd",
    });
  });
});
