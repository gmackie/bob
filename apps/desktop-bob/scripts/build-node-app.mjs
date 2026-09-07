#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = path.join(root, "apps/bob");
const destination = path.resolve(process.env.BOB_NODE_APP_DIR ?? path.join(root, "apps/desktop-bob/.node-app"));
// Vinext detects wrangler.jsonc by filesystem presence and otherwise refuses
// Node builds. Build a separate app root, preserving the deployed Worker output.
fs.mkdirSync(destination, { recursive: true });
for (const name of ["src", "public", "package.json", "postcss.config.js", "vite.config.ts", "tsconfig.json"]) {
  fs.rmSync(path.join(destination, name), { recursive: true, force: true });
  fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true, force: true });
}
const config = JSON.parse(fs.readFileSync(path.join(destination, "tsconfig.json"), "utf8"));
for (const [key, values] of Object.entries(config.compilerOptions.paths)) {
  config.compilerOptions.paths[key] = values.map(value => value.startsWith("../../") ? path.resolve(source, value) : value);
}
fs.writeFileSync(path.join(destination, "tsconfig.json"), JSON.stringify(config, null, 2));
// Preserve the workspace's root-level hoisted build-tool resolution too.
const modules = path.join(destination, "node_modules");
if (fs.lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(modules);
fs.mkdirSync(modules, { recursive: true });
function linkModules(from, into) {
  for (const name of fs.readdirSync(from)) {
    if (name.startsWith(".")) continue;
    const src = path.join(from, name), dst = path.join(into, name);
    if (name.startsWith("@")) { fs.mkdirSync(dst, { recursive: true }); linkModules(src, dst); continue; }
    fs.rmSync(dst, { force: true, recursive: true });
    fs.symlinkSync(fs.realpathSync(src), dst, "dir");
  }
}
linkModules(path.join(root, "node_modules"), modules);
linkModules(path.join(source, "node_modules"), modules);
const css = path.join(destination, "src/app/styles.css");
if (fs.existsSync(css)) fs.writeFileSync(css, fs.readFileSync(css, "utf8").replaceAll("../../../../packages/", `${root}/packages/`));

const result = spawnSync(process.execPath, [path.join(source, "node_modules/vinext/dist/cli.js"), "build"], {
  cwd: destination, stdio: "inherit", env: { ...process.env, BOB_BUILD_TARGET: "node" },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[build-node-app] ${destination}`);
