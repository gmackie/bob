import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse, stringify } from "yaml";
import { target } from "./stage-desktop-shell.mjs";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = parse(fs.readFileSync(path.join(desktop, "electron-builder.yml"), "utf8"));
config.electronVersion = createRequire(import.meta.url)("electron/package.json").version;
config.npmRebuild = false; // The shell has no external/native runtime dependencies.
config.directories = { output: path.join(desktop, "release"), buildResources: path.join(desktop, "build") };
config.extraResources = config.extraResources.map(resource => ({ ...resource, from: path.resolve(desktop, resource.from) }));
// Use the isolated shell as both app and project root. Otherwise the collector
// falls back from an empty app dependency list to scanning the entire workspace.
const configPath = path.join(target, "electron-builder.yml");
fs.writeFileSync(configPath, stringify(config));
const cli = createRequire(import.meta.url).resolve("electron-builder/cli.js");
const result = spawnSync(process.execPath, [cli, "--projectDir", target, "--config", configPath, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
