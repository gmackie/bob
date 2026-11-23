import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const target = path.join(desktop, ".packaging", "desktop-shell");
const source = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8"));
// tsdown bundles ws and @gmacko/* into the shell. Packaging its workspace
// manifest makes electron-builder enumerate the whole monorepo dependency graph.
const manifest = Object.fromEntries(["name", "version", "license", "main", "productName"].map(key => [key, source[key]]));
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(desktop, "dist-electron"), path.join(target, "dist-electron"), { recursive: true });
fs.writeFileSync(path.join(target, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(target, "package-lock.json"), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, packages: { "": manifest } }, null, 2) + "\n");
console.log(`[stage-desktop-shell] ${target}`);
