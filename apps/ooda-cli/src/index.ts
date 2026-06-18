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

    case "oracle": {
      const subcommand = args[1];
      if (subcommand === "ingest-bookmarks") {
        const jsonlPath = args[2];
        if (!jsonlPath) {
          console.error("Usage: ooda oracle ingest-bookmarks <path-to-bookmarks.jsonl> [--embed]");
          process.exit(1);
        }
        const shouldEmbed = args.includes("--embed");
        const { importFieldtheoryJsonl } = await import("@gmacko/ooda/oracle");
        const { db } = await import("@gmacko/ooda/db/client");
        const {
          researchVaultSources,
          researchVaultRetrievalUnits,
          researchVaultRetrievalUnitEmbeddings,
        } = await import("@gmacko/ooda/db/schema");

        console.log(`Importing bookmarks from ${jsonlPath}...`);
        const result = await importFieldtheoryJsonl(
          db as any,
          {
            sources: researchVaultSources,
            retrievalUnit: researchVaultRetrievalUnits,
            retrievalUnitEmbedding: researchVaultRetrievalUnitEmbeddings,
          },
          jsonlPath,
          { embed: shouldEmbed, apiKey: process.env.OPENAI_API_KEY },
        );
        console.log(`  Imported: ${result.imported}`);
        console.log(`  Skipped: ${result.skipped}`);
        if (result.errors.length > 0) {
          console.log(`  Errors: ${result.errors.length}`);
          for (const err of result.errors.slice(0, 5)) {
            console.log(`    ${err.tweetId}: ${err.error}`);
          }
        }
      } else if (subcommand === "ingest-conversations") {
        const filePath = args[2];
        if (!filePath) {
          console.error("Usage: ooda oracle ingest-conversations <path-to-export.json> [--embed]");
          process.exit(1);
        }
        const shouldEmbed = args.includes("--embed");
        const { readFileSync } = await import("node:fs");
        const { importConversations } = await import("@gmacko/ooda/oracle");
        const { db } = await import("@gmacko/ooda/db/client");
        const {
          researchVaultSources,
          researchVaultRetrievalUnits,
          researchVaultRetrievalUnitEmbeddings,
        } = await import("@gmacko/ooda/db/schema");

        console.log(`Importing conversations from ${filePath}...`);
        const jsonData = JSON.parse(readFileSync(filePath, "utf-8"));
        const result = await importConversations(
          db as any,
          {
            sources: researchVaultSources,
            retrievalUnit: researchVaultRetrievalUnits,
            retrievalUnitEmbedding: researchVaultRetrievalUnitEmbeddings,
          },
          jsonData,
          { embed: shouldEmbed, apiKey: process.env.OPENAI_API_KEY },
        );
        console.log(`  Imported: ${result.imported}`);
        console.log(`  Skipped: ${result.skipped}`);
        if (result.errors.length > 0) {
          console.log(`  Errors: ${result.errors.length}`);
          for (const err of result.errors.slice(0, 5)) {
            console.log(`    ${err.conversationId}: ${err.error}`);
          }
        }
      } else if (subcommand === "query") {
        const question = args.slice(2).join(" ");
        if (!question) {
          console.error("Usage: ooda oracle query <question>");
          process.exit(1);
        }
        const { oracleQuery } = await import("@gmacko/ooda/oracle");
        const { db } = await import("@gmacko/ooda/db/client");
        const {
          researchVaultSources,
          researchVaultRetrievalUnits,
          researchVaultRetrievalUnitEmbeddings,
        } = await import("@gmacko/ooda/db/schema");

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          console.error("OPENAI_API_KEY not set");
          process.exit(1);
        }

        const result = await oracleQuery(
          db as any,
          {
            sources: researchVaultSources,
            retrievalUnit: researchVaultRetrievalUnits,
            retrievalUnitEmbedding: researchVaultRetrievalUnitEmbeddings,
          },
          { task: "CLI query", question },
          apiKey,
        );

        console.log(`\nOracle results (${result.chunks.length} chunks, ${result.latencyMs}ms):\n`);
        for (const chunk of result.chunks) {
          console.log(`--- [${chunk.sourceKind}] ${chunk.sourceTitle ?? "untitled"} (score: ${chunk.score.toFixed(3)}) ---`);
          console.log(chunk.content.slice(0, 300));
          if (chunk.sourceUrl) console.log(`  URL: ${chunk.sourceUrl}`);
          console.log();
        }
      } else {
        console.log(`Oracle commands:
  ooda oracle ingest-bookmarks <path.jsonl> [--embed]   Import fieldtheory X bookmarks
  ooda oracle ingest-conversations <path.json> [--embed] Import AI conversation exports
  ooda oracle query <question>                          Query the oracle
`);
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
  ooda oracle               Oracle knowledge system commands
`);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
