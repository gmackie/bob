#!/usr/bin/env node
/**
 * Cross-compile the external github.com/blder/bob CLI into resources/bin/.
 *
 * Requires Go and network access to fetch the module. Binaries are named
 * bob-<os>-<arch> (plus .exe on Windows) to match resolveDaemonBinaryPath().
 *
 * Usage:
 *   node scripts/build-daemon.mjs
 *   GOOS=linux GOARCH=amd64 node scripts/build-daemon.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const outDir = path.join(desktopDir, "resources", "bin");

const targets = [
  { goos: "darwin", goarch: "arm64" },
  { goos: "darwin", goarch: "amd64" },
  { goos: "linux", goarch: "amd64" },
  { goos: "linux", goarch: "arm64" },
  { goos: "windows", goarch: "amd64" },
];

function outputName(goos, goarch) {
  const base = `bob-${goos}-${goarch}`;
  return goos === "windows" ? `${base}.exe` : base;
}

function buildOne(target) {
  const env = {
    ...process.env,
    GOOS: target.goos,
    GOARCH: target.goarch,
    CGO_ENABLED: "0",
  };
  const outPath = path.join(outDir, outputName(target.goos, target.goarch));
  fs.mkdirSync(outDir, { recursive: true });

  const result = spawnSync(
    "go",
    ["build", "-o", outPath, "github.com/blder/bob/cmd/bob"],
    {
      env,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `go build failed for ${target.goos}/${target.goarch} (status ${result.status ?? "?"})`,
    );
  }
  if (target.goos !== "windows") {
    fs.chmodSync(outPath, 0o755);
  }
  console.log(`[build-daemon] wrote ${outPath}`);
}

function main() {
  const go = spawnSync("go", ["version"], { encoding: "utf8" });
  if (go.status !== 0) {
    console.error(
      "[build-daemon] Go toolchain not found. Install Go to rebuild daemon binaries.",
    );
    process.exit(1);
  }

  const filterGoos = process.env.GOOS;
  const filterGoarch = process.env.GOARCH;
  const selected = targets.filter((target) => {
    if (filterGoos && target.goos !== filterGoos) return false;
    if (filterGoarch && target.goarch !== filterGoarch) return false;
    return true;
  });

  if (selected.length === 0) {
    console.error(
      `[build-daemon] no targets matched GOOS=${filterGoos ?? "*"} GOARCH=${filterGoarch ?? "*"}`,
    );
    process.exit(1);
  }

  console.log(
    `[build-daemon] building ${selected.length} target(s) on ${os.platform()}/${os.arch()}`,
  );
  for (const target of selected) {
    buildOne(target);
  }
}

main();
