import { eq, and, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "../db/schema";
import { chunkSource, type Chunk } from "./chunker";
import { generateEmbeddings } from "./embeddings";

type DB = PostgresJsDatabase<typeof schema>;

interface VaultRetrievalTables {
  retrievalUnit: typeof schema.researchVaultRetrievalUnits;
  retrievalUnitEmbedding: typeof schema.researchVaultRetrievalUnitEmbeddings;
}

export interface IngestSourceInput {
  sourceId: number;
  body: string;
  contentAsOf?: Date;
}

export interface IngestResult {
  sourceId: number;
  chunksCreated: number;
  embeddingsCreated: number;
}

export async function ingestSourceChunks(
  db: DB,
  tables: VaultRetrievalTables,
  input: IngestSourceInput,
): Promise<IngestResult> {
  const chunks = chunkSource({
    sourceId: input.sourceId,
    body: input.body,
    contentAsOf: input.contentAsOf,
  });

  if (chunks.length === 0) {
    return { sourceId: input.sourceId, chunksCreated: 0, embeddingsCreated: 0 };
  }

  await db
    .delete(tables.retrievalUnit)
    .where(eq(tables.retrievalUnit.sourceId, input.sourceId));

  const insertedUnits = await db
    .insert(tables.retrievalUnit)
    .values(
      chunks.map((c) => ({
        sourceId: c.sourceId,
        chunkIndex: c.chunkIndex,
        content: c.content,
        tokenCount: c.tokenCount,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        headingContext: c.headingContext,
        confidence: 1.0,
        sourceQuality: 1.0,
        contentAsOf: c.contentAsOf,
      })),
    )
    .returning({ id: tables.retrievalUnit.id });

  return {
    sourceId: input.sourceId,
    chunksCreated: insertedUnits.length,
    embeddingsCreated: 0,
  };
}

export async function embedSourceChunks(
  db: DB,
  tables: VaultRetrievalTables,
  sourceId: number,
  apiKey: string,
): Promise<number> {
  const units = await db
    .select({
      id: tables.retrievalUnit.id,
      content: tables.retrievalUnit.content,
    })
    .from(tables.retrievalUnit)
    .where(eq(tables.retrievalUnit.sourceId, sourceId));

  if (units.length === 0) return 0;

  const unembedded = await db
    .select({ id: tables.retrievalUnit.id, content: tables.retrievalUnit.content })
    .from(tables.retrievalUnit)
    .leftJoin(
      tables.retrievalUnitEmbedding,
      and(
        eq(tables.retrievalUnitEmbedding.unitId, tables.retrievalUnit.id),
        eq(tables.retrievalUnitEmbedding.model, "text-embedding-3-small"),
      ),
    )
    .where(
      and(
        eq(tables.retrievalUnit.sourceId, sourceId),
        sql`${tables.retrievalUnitEmbedding.unitId} IS NULL`,
      ),
    );

  if (unembedded.length === 0) return 0;

  const batchSize = 50;
  let totalEmbedded = 0;

  for (let i = 0; i < unembedded.length; i += batchSize) {
    const batch = unembedded.slice(i, i + batchSize);
    const results = await generateEmbeddings(
      batch.map((u) => u.content),
      apiKey,
    );

    await db.insert(tables.retrievalUnitEmbedding).values(
      batch.map((u, idx) => ({
        unitId: u.id,
        model: results[idx]!.model,
        embedding: results[idx]!.embedding,
      })),
    );

    totalEmbedded += batch.length;
  }

  return totalEmbedded;
}

export async function ingestAndEmbed(
  db: DB,
  tables: VaultRetrievalTables,
  input: IngestSourceInput,
  apiKey: string,
): Promise<IngestResult> {
  const result = await ingestSourceChunks(db, tables, input);

  if (result.chunksCreated > 0) {
    result.embeddingsCreated = await embedSourceChunks(
      db,
      tables,
      input.sourceId,
      apiKey,
    );
  }

  return result;
}
