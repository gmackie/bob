import postgres from "postgres";

import {
  backfillStandaloneVaultEmbeddings,
  copyStandaloneVault,
  findStandaloneVaultRun,
  inventoryStandaloneVault,
  verifyStandaloneVault,
} from "../src/db/migrations/standalone-vault";

const command = process.argv[2] ?? "inventory";
const sourceDatabaseUrl = process.env.STANDALONE_OODA_DATABASE_URL;
const targetDatabaseUrl = process.env.DATABASE_URL;
const ownerId = process.env.OODA_MIGRATION_OWNER_ID;

if (!sourceDatabaseUrl) throw new Error("Missing STANDALONE_OODA_DATABASE_URL");
if (!targetDatabaseUrl && command !== "inventory") {
  throw new Error("Missing DATABASE_URL");
}
if (!ownerId && command !== "inventory") {
  throw new Error("Missing OODA_MIGRATION_OWNER_ID");
}

const source = postgres(sourceDatabaseUrl, { max: 1 });
const target = targetDatabaseUrl
  ? postgres(targetDatabaseUrl, { max: 2 })
  : null;

try {
  await source`set default_transaction_read_only = on`;
  const inventory = await inventoryStandaloneVault(source);
  if (command === "inventory") {
    console.log(JSON.stringify(inventory, null, 2));
    process.exitCode = 0;
  } else {
    if (!target || !ownerId)
      throw new Error("Target configuration is incomplete");
    const confirmation = process.env.OODA_STANDALONE_IMPORT_CONFIRM;
    if (
      ["copy", "embed"].includes(command) &&
      confirmation !== inventory.fingerprint
    ) {
      throw new Error(
        `Refusing ${command}: set OODA_STANDALONE_IMPORT_CONFIRM to ${inventory.fingerprint}`,
      );
    }

    if (command === "copy") {
      const receipt = await copyStandaloneVault(source, target, ownerId, {
        batchSize: Number(process.env.OODA_STANDALONE_IMPORT_BATCH_SIZE ?? 500),
        ...(process.env.OODA_STANDALONE_IMPORT_MAX_SOURCES
          ? {
              maxSources: Number(
                process.env.OODA_STANDALONE_IMPORT_MAX_SOURCES,
              ),
            }
          : {}),
        onProgress: (message) => console.error(message),
      });
      console.log(JSON.stringify(receipt, null, 2));
    } else {
      const run = await findStandaloneVaultRun(
        target,
        ownerId,
        inventory.fingerprint,
      );
      if (!run)
        throw new Error(
          "Run the copy command before embedding or verification",
        );
      if (command === "embed") {
        const receipt = await backfillStandaloneVaultEmbeddings(
          source,
          target,
          run.id,
          {
            baseUrl: process.env.OLLAMA_BASE_URL,
            model: process.env.OLLAMA_EMBEDDING_MODEL,
            batchSize: Number(
              process.env.OODA_STANDALONE_EMBED_BATCH_SIZE ?? 32,
            ),
            ...(process.env.OODA_STANDALONE_EMBED_MAX_SOURCES
              ? {
                  maxSources: Number(
                    process.env.OODA_STANDALONE_EMBED_MAX_SOURCES,
                  ),
                }
              : {}),
            onProgress: (message) => console.error(message),
          },
        );
        console.log(JSON.stringify(receipt, null, 2));
      } else if (command === "verify") {
        const receipt = await verifyStandaloneVault(
          source,
          target,
          run.id,
          inventory,
          process.env.OLLAMA_EMBEDDING_MODEL,
        );
        console.log(JSON.stringify(receipt, null, 2));
        if (!receipt.copyOk) process.exitCode = 1;
      } else {
        throw new Error(`Unknown command: ${command}`);
      }
    }
  }
} finally {
  await Promise.all([source.end(), target?.end()]);
}
