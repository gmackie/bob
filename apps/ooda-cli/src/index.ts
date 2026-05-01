#!/usr/bin/env node

import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

import { createThreadWorkspace } from "@gmacko/ooda/thread-workspace";

import { readThreads, formatThreadList } from "./commands/threads";
import { formatStatus } from "./commands/status";
import { runExport } from "./commands/export";

const args = process.argv.slice(2);
const command = args[0];

const storageRoot =
  process.env.OODA_STORAGE_ROOT ?? join(homedir(), ".ooda", "threads");

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  switch (command) {
    case "threads":
    case "list": {
      const isJson = args.includes("--json");
      const threads = readThreads(storageRoot);
      console.log(formatThreadList(threads, { json: isJson }));
      break;
    }

    case "status": {
      console.log(formatStatus({ storageRoot }));
      break;
    }

    case "export": {
      const threadSlug = args[1];
      if (!threadSlug) {
        console.error("Usage: ooda export <thread-slug>");
        process.exit(1);
      }
      const title = args[2] ?? undefined;
      const brief = runExport({ storageRoot, threadSlug, title });

      const outputArg = args.find((a) => a.startsWith("--output="));
      if (outputArg) {
        const path = outputArg.split("=")[1]!;
        writeFileSync(path, brief);
        console.log(`Brief written to ${path}`);
      } else {
        console.log(brief);
      }
      break;
    }

    case "new": {
      const title = args.slice(1).join(" ");
      if (!title) {
        console.error("Usage: ooda new <title>");
        process.exit(1);
      }
      const slug = slugify(title);
      const result = await createThreadWorkspace({
        storageRoot,
        slug,
        title,
      });
      console.log(`Created thread workspace: ${result.threadDir}`);
      break;
    }

    case "init": {
      const remoteUrl = args[1];
      if (!remoteUrl) {
        console.error("Usage: ooda init <remote-url>");
        process.exit(1);
      }
      const { initVaultRepo } = await import("@gmacko/ooda/thread-workspace");
      const { existsSync, mkdirSync } = await import("node:fs");

      if (!existsSync(storageRoot)) {
        mkdirSync(storageRoot, { recursive: true });
      }
      await initVaultRepo(storageRoot, remoteUrl);
      console.log(`Vault initialized at ${storageRoot} with remote ${remoteUrl}`);
      break;
    }

    case "migrate": {
      const remoteUrl = args[1];
      if (!remoteUrl) {
        console.error("Usage: ooda migrate <remote-url>");
        process.exit(1);
      }
      const { migrateToVaultRepo } = await import("./commands/migrate-to-vault");
      const result = await migrateToVaultRepo(storageRoot, remoteUrl);
      console.log(`Migrated ${result.migrated.length} threads: ${result.migrated.join(", ")}`);
      if (result.skipped.length > 0) {
        console.log(`Skipped ${result.skipped.length}: ${result.skipped.join(", ")}`);
      }
      break;
    }

    case "sync": {
      const { pullVault, pushVault } = await import("@gmacko/ooda/thread-workspace");

      console.log("Pulling from remote...");
      const result = await pullVault(storageRoot);
      console.log(`  ${result.filesChanged} files changed`);

      if (result.conflicts) {
        console.log(`  Conflicts in: ${result.conflictFiles.join(", ")}`);
        console.log("  Resolve conflicts, then run: ooda sync");
      } else {
        console.log("Pushing to remote...");
        await pushVault(storageRoot);
        console.log("  Synced.");
      }
      break;
    }

    default:
      console.log(`OODA Research Workstation CLI

Commands:
  ooda threads [--json]     List research threads
  ooda status               Show system status
  ooda new <title>          Create a new thread
  ooda export <slug>        Export research brief
  ooda export <slug> --output=<path>  Export to file
  ooda init <remote-url>    Initialize vault with ForgeGraph remote
  ooda sync                 Pull + push vault repo
  ooda migrate <remote-url>  Migrate per-thread repos to vault repo
`);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
