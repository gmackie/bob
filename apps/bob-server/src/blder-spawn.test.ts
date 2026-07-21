import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  buildBlderLaunchSpec,
  resolveBlderDir,
  resolveVinextCli,
} from "./blder-spawn.js";

const originalEnv = { ...process.env };
const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bob-blder-spawn-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  process.env = { ...originalEnv };
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveBlderDir", () => {
  it("prefers BOB_BLDER_DIR when set", () => {
    process.env.BOB_BLDER_DIR = "/tmp/custom-blder";
    expect(resolveBlderDir()).toBe("/tmp/custom-blder");
  });
});

describe("buildBlderLaunchSpec", () => {
  it("uses vinext dev in desktop dev mode", () => {
    const blderDir = makeTempDir();
    const vinextCli = path.join(blderDir, "node_modules", "vinext", "dist", "cli.js");
    fs.mkdirSync(path.dirname(vinextCli), { recursive: true });
    fs.writeFileSync(vinextCli, "export {};\n");

    const spec = buildBlderLaunchSpec({
      blderDir,
      port: 4321,
      useDev: true,
    });

    expect(spec.executable).toBe(process.execPath);
    expect(spec.args).toEqual([
      vinextCli,
      "dev",
      "--port",
      "4321",
      "--hostname",
      "127.0.0.1",
    ]);
    expect(spec.cwd).toBe(blderDir);
  });

  it("uses the App Router production entry when present", () => {
    const blderDir = makeTempDir();
    const entry = path.join(blderDir, "dist", "server", "index.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "export default async () => new Response('ok');\n");

    const spec = buildBlderLaunchSpec({
      blderDir,
      port: 9876,
      useDev: false,
    });

    expect(spec.args).toEqual([entry]);
    expect(resolveVinextCli(blderDir)).toContain("vinext/dist/cli.js");
  });

  it("uses the Pages Router production entry when present", () => {
    const blderDir = makeTempDir();
    const entry = path.join(blderDir, "dist", "server", "entry.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "export function renderPage() {}\n");

    const spec = buildBlderLaunchSpec({
      blderDir,
      port: 5555,
      useDev: false,
    });

    expect(spec.args).toEqual([entry]);
  });
});
