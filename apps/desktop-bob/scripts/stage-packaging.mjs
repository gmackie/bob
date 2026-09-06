#!/usr/bin/env node
/**
 * Stage portable bob-server + blder bundles for electron-builder extraResources.
 *
 * Run from apps/desktop-bob after workspace packages are built:
 *   pnpm --filter @bob/blder build
 *   pnpm --filter @bob/server build
 *   node scripts/stage-packaging.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizePortableDeploy } from "./portable-deploy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "../..");
const nodeAppDir = path.resolve(process.env.BOB_NODE_APP_DIR ?? path.join(desktopDir, ".node-app"));
const stagingDir = path.resolve(process.env.BOB_PACKAGING_DIR ?? path.join(desktopDir, ".packaging"));

const targets = {
  bobServer: path.join(stagingDir, "bob-server"),
  blder: path.join(stagingDir, "blder"),
  dbMigrations: path.join(stagingDir, "db-migrations"),
};

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

function runDeploy(filter, targetDir) {
  rmrf(targetDir);
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  const result = spawnSync("pnpm", ["--filter", filter, "deploy", "--legacy", "--prod", targetDir], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`pnpm deploy failed for ${filter}`);
  }
  finalizePortableDeploy(repoRoot, targetDir);
}

function assertExists(label, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${label} missing at ${filePath}. Build workspace packages before staging.`,
    );
  }
}

function main() {
  const build = spawnSync(process.execPath, [path.join(__dirname, "build-node-app.mjs")], { cwd: repoRoot, stdio: "inherit", env: { ...process.env, BOB_NODE_APP_DIR: nodeAppDir } });
  if (build.status !== 0) throw new Error("Node app build failed");
  const serverBuild = spawnSync("pnpm", ["--filter", "@bob/server", "build"], { cwd: repoRoot, stdio: "inherit", env: process.env });
  if (serverBuild.status !== 0) throw new Error("Server build failed");
  const bobServerSrc = path.join(repoRoot, "apps/bob-server");
  const blderSrc = nodeAppDir;
  const migrationsSrc = path.join(
    repoRoot,
    "packages/bob/src/db/drizzle",
  );

  assertExists("@bob/server dist", path.join(bobServerSrc, "dist/bin.js"));
  assertExists(
    "@bob/blder dist",
    path.join(blderSrc, "dist/server/index.js"),
  );

  rmrf(stagingDir);
  fs.mkdirSync(stagingDir, { recursive: true });

  runDeploy("@bob/server", targets.bobServer);
  runDeploy("@bob/blder", targets.blder);
  rmrf(path.join(targets.blder, "dist"));
  copyDir(path.join(nodeAppDir, "dist"), path.join(targets.blder, "dist"));
  copyDir(migrationsSrc, targets.dbMigrations);

  console.log(`[stage-packaging] staged resources under ${stagingDir}`);
}

main();
