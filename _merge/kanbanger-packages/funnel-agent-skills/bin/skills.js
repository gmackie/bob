#!/usr/bin/env node
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { readdirSync } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(packageRoot, "..", "skills");
const skillArg = process.argv[2];
const destinationArg = process.argv[3];

function printHelp() {
  console.log(`Linear Clone Funnel Skills Installer

Usage:
  skills install [path]
  skills --help

Commands:
  install [path]
      Install funnel workflow skills into the destination path.
      Defaults to ~/.codex/skills.
      If ~/.codex/skills does not exist, falls back to ~/.agents/skills.
`);
}

function parseDestination() {
  if (destinationArg) {
    return destinationArg;
  }

  const codex = join(homedir(), ".codex", "skills");
  if (existsSync(codex)) {
    return codex;
  }

  return join(homedir(), ".agents", "skills");
}

function resolvePackageSkills() {
  return readdirSync(sourceDir, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    );
}

async function run() {
  if (skillArg === "install" || !skillArg) {
    const destination = skillArg === "install" ? parseDestination() : parseDestination();
    const skillNames = await resolvePackageSkills();

    mkdirSync(destination, { recursive: true });

    for (const name of skillNames) {
      const sourcePath = join(sourceDir, name);
      const destPath = join(destination, name);
      cpSync(sourcePath, destPath, { recursive: true });
    }

    console.log(`Installed ${skillNames.length} skill(s) to ${destination}`);
    return;
  }

  if (skillArg === "--help" || skillArg === "-h") {
    printHelp();
    return;
  }

  printHelp();
  process.exitCode = 1;
}

run().catch((error) => {
  console.error("Failed to install skills:", error?.message ?? error);
  process.exitCode = 1;
});
