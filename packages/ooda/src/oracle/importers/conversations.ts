import { eq, and } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "../../db/schema";
import { normalizeImport } from "../../imports/normalize";
import { conversationToSourceRecord } from "../../imports/to-source-record";
import { ingestAndEmbed } from "../ingest";

type DB = PostgresJsDatabase<typeof schema>;

interface VaultTables {
  sources: typeof schema.researchVaultSources;
  retrievalUnit: typeof schema.researchVaultRetrievalUnits;
  retrievalUnitEmbedding: typeof schema.researchVaultRetrievalUnitEmbeddings;
}

export interface ConversationImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ conversationId: string; error: string }>;
}

export async function importConversations(
  db: DB,
  tables: VaultTables,
  jsonData: unknown,
  options?: { embed?: boolean; apiKey?: string },
): Promise<ConversationImportResult> {
  const result: ConversationImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
  };

  const { conversations } = normalizeImport(jsonData);

  for (const conv of conversations) {
    try {
      const record = conversationToSourceRecord(conv);

      const existing = await db
        .select({ id: tables.sources.id, contentHash: tables.sources.contentHash })
        .from(tables.sources)
        .where(
          and(
            eq(tables.sources.kind, "chat-import"),
            eq(tables.sources.externalId, record.externalId),
          ),
        )
        .limit(1);

      if (existing.length > 0 && existing[0]!.contentHash === record.contentHash) {
        result.skipped++;
        continue;
      }

      let sourceId: number;

      if (existing.length > 0) {
        await db
          .update(tables.sources)
          .set({
            title: record.title,
            body: record.body,
            contentHash: record.contentHash,
            author: record.author ?? null,
            sourceTs: record.sourceTs ? new Date(record.sourceTs) : null,
          })
          .where(eq(tables.sources.id, existing[0]!.id));
        sourceId = existing[0]!.id;
      } else {
        const [inserted] = await db
          .insert(tables.sources)
          .values({
            kind: "chat-import",
            externalId: record.externalId,
            title: record.title,
            body: record.body,
            contentHash: record.contentHash,
            author: record.author ?? null,
            sourceTs: record.sourceTs ? new Date(record.sourceTs) : null,
          })
          .returning({ id: tables.sources.id });
        sourceId = inserted!.id;
      }

      if (options?.embed && options.apiKey) {
        await ingestAndEmbed(
          db,
          tables,
          {
            sourceId,
            body: record.body,
            contentAsOf: record.sourceTs ? new Date(record.sourceTs) : undefined,
          },
          options.apiKey,
        );
      }

      result.imported++;
    } catch (e) {
      result.errors.push({
        conversationId: conv.conversationId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
