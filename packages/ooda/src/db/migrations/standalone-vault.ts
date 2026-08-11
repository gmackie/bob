import postgres from "postgres";

export type PostgresClient = ReturnType<typeof postgres>;

const MIGRATION_SOURCE = "standalone-ooda-vault-v1";
export const STANDALONE_SOURCE_EMBEDDING_DIMENSIONS = 768;
export const STANDALONE_EMBEDDING_INPUT_CHARACTERS = 4_000;

export function parseLegacyFloat32Embedding(
  value: Uint8Array,
  dimensions: number,
): number[] {
  const expectedBytes =
    STANDALONE_SOURCE_EMBEDDING_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT;
  if (
    dimensions !== STANDALONE_SOURCE_EMBEDDING_DIMENSIONS ||
    value.byteLength !== expectedBytes
  ) {
    throw new Error(
      `Legacy embedding must contain ${STANDALONE_SOURCE_EMBEDDING_DIMENSIONS} dimensions in ${expectedBytes} bytes`,
    );
  }

  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const embedding = Array.from(
    { length: STANDALONE_SOURCE_EMBEDDING_DIMENSIONS },
    (_, index) => bytes.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT),
  );
  if (!embedding.every(Number.isFinite)) {
    throw new Error("Legacy embedding contains a non-finite component");
  }
  return embedding;
}

export function buildStandaloneEmbeddingInput(
  title: string | null,
  body: string,
): string {
  const input = [title, body].filter(Boolean).join("\n\n");
  if (input.length <= STANDALONE_EMBEDDING_INPUT_CHARACTERS) return input;

  const omission = "\n\n[...]\n\n";
  const available = STANDALONE_EMBEDDING_INPUT_CHARACTERS - omission.length;
  const openingCharacters = Math.ceil(available * 0.7);
  const closingCharacters = available - openingCharacters;
  return `${input.slice(0, openingCharacters)}${omission}${input.slice(
    -closingCharacters,
  )}`;
}

export type StandaloneVaultInventory = {
  sources: number;
  legacyEmbeddings: number;
  topics: number;
  sourceTopics: number;
  sourceHash: string;
  kinds: Record<string, number>;
  fingerprint: string;
};

export type StandaloneVaultVerification = {
  runId: string;
  source: StandaloneVaultInventory;
  destination: {
    sources: number;
    topics: number;
    sourceTopics: number;
    nativeEmbeddings: number;
    embeddingModel: string;
    sourceHash: string;
  };
  checks: {
    sources: boolean;
    topics: boolean;
    sourceTopics: boolean;
    sourceHash: boolean;
    nativeEmbeddings: boolean;
  };
  copyOk: boolean;
  embeddingComplete: boolean;
};

type MigrationRun = {
  id: string;
  cursor: string | null;
};

type SourceRow = {
  id: number;
  kind: string;
  externalId: string;
  title: string | null;
  body: string;
  frontmatter: string | null;
  url: string | null;
  author: string | null;
  sourceTs: Date | null;
  importedAt: Date;
  contentHash: string;
};

type TopicRow = {
  id: number;
  label: string | null;
  description: string | null;
  centroid: Buffer | null;
  sourceCount: number;
  createdAt: Date;
};

type SourceTopicRow = {
  sourceId: number;
  topicId: number;
  score: number;
};

export function buildStandaloneVaultFingerprint(input: {
  sources: number;
  legacyEmbeddings: number;
  topics: number;
  sourceTopics: number;
  sourceHash: string;
}): string {
  return [
    MIGRATION_SOURCE,
    input.sources,
    input.legacyEmbeddings,
    input.topics,
    input.sourceTopics,
    input.sourceHash,
  ].join(":");
}

export function parseOllamaEmbeddings(
  value: unknown,
  expectedCount: number,
): number[][] {
  if (!value || typeof value !== "object" || !("embeddings" in value)) {
    throw new Error("Ollama response did not contain embeddings");
  }
  const embeddings = (value as { embeddings: unknown }).embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) {
    throw new Error(
      `Ollama returned ${Array.isArray(embeddings) ? embeddings.length : 0} embeddings; expected ${expectedCount}`,
    );
  }
  return embeddings.map((embedding, index) => {
    if (
      !Array.isArray(embedding) ||
      embedding.length !== STANDALONE_SOURCE_EMBEDDING_DIMENSIONS ||
      !embedding.every(
        (component) =>
          typeof component === "number" && Number.isFinite(component),
      )
    ) {
      throw new Error(
        `Ollama embedding ${index} is not a finite ${STANDALONE_SOURCE_EMBEDDING_DIMENSIONS}-dimension vector`,
      );
    }
    return embedding as number[];
  });
}

export async function inventoryStandaloneVault(
  source: PostgresClient,
): Promise<StandaloneVaultInventory> {
  const [summary] = await source<
    Array<{
      sources: number;
      legacyEmbeddings: number;
      topics: number;
      sourceTopics: number;
      sourceHash: string;
    }>
  >`
    select
      (select count(*)::int from research_vault.sources) as sources,
      (select count(*)::int from research_vault.embeddings) as "legacyEmbeddings",
      (select count(*)::int from research_vault.topics) as topics,
      (select count(*)::int from research_vault.source_topics) as "sourceTopics",
      (
        select md5(coalesce(string_agg(id::text || ':' || content_hash, ',' order by id), ''))
        from research_vault.sources
      ) as "sourceHash"
  `;
  if (!summary) throw new Error("Standalone vault inventory returned no row");
  const kindRows = await source<Array<{ kind: string; count: number }>>`
    select kind::text as kind, count(*)::int as count
    from research_vault.sources
    group by kind
    order by kind
  `;
  const inventory = {
    ...summary,
    kinds: Object.fromEntries(kindRows.map((row) => [row.kind, row.count])),
  };
  return {
    ...inventory,
    fingerprint: buildStandaloneVaultFingerprint(inventory),
  };
}

async function getOrCreateRun(
  target: PostgresClient,
  ownerId: string,
  inventory: StandaloneVaultInventory,
): Promise<MigrationRun> {
  const [run] = await target<Array<MigrationRun>>`
    insert into ooda.migration_runs (
      owner_id, source, source_fingerprint, source_counts
    ) values (
      ${ownerId}, ${MIGRATION_SOURCE}, ${inventory.fingerprint},
      ${target.json({
        sources: inventory.sources,
        legacyEmbeddings: inventory.legacyEmbeddings,
        topics: inventory.topics,
        sourceTopics: inventory.sourceTopics,
      })}
    )
    on conflict (owner_id, source, source_fingerprint) do update
      set source_counts = excluded.source_counts,
          updated_at = now()
    returning id, cursor
  `;
  if (!run) throw new Error("Could not create standalone migration run");
  if (run.cursor) return run;
  const [progress] = await target<Array<{ cursor: string | null }>>`
    select max(source_id::integer)::text as cursor
    from ooda.migration_records
    where run_id = ${run.id}::uuid and entity_type = 'source'
  `;
  return { ...run, cursor: progress?.cursor ?? null };
}

export async function findStandaloneVaultRun(
  target: PostgresClient,
  ownerId: string,
  fingerprint: string,
): Promise<MigrationRun | null> {
  const [run] = await target<Array<MigrationRun>>`
    select id, cursor
    from ooda.migration_runs
    where owner_id = ${ownerId}
      and source = ${MIGRATION_SOURCE}
      and source_fingerprint = ${fingerprint}
    limit 1
  `;
  return run ?? null;
}

function serializeSources(rows: SourceRow[]) {
  return rows.map((row) => ({
    source_id: row.id,
    kind: row.kind,
    external_id: row.externalId,
    title: row.title,
    body: row.body,
    frontmatter: row.frontmatter,
    url: row.url,
    author: row.author,
    source_ts: row.sourceTs?.toISOString() ?? null,
    imported_at: row.importedAt.toISOString(),
    content_hash: row.contentHash,
  }));
}

async function copySourceBatch(
  target: PostgresClient,
  runId: string,
  rows: SourceRow[],
): Promise<void> {
  const payload = serializeSources(rows);
  await target.begin(async (tx) => {
    const conflicts = await tx<Array<{ sourceId: number; externalId: string }>>`
      with incoming as (
        select * from jsonb_to_recordset(${tx.json(payload)}::jsonb) as value(
          source_id integer,
          kind text,
          external_id text,
          title text,
          body text,
          frontmatter text,
          url text,
          author text,
          source_ts text,
          imported_at text,
          content_hash text
        )
      )
      select incoming.source_id as "sourceId", incoming.external_id as "externalId"
      from incoming
      join research_vault.sources destination
        on destination.kind::text = incoming.kind
       and destination.external_id = incoming.external_id
      where destination.content_hash <> incoming.content_hash
      order by incoming.source_id
      limit 10
    `;
    if (conflicts.length > 0) {
      throw new Error(
        `Standalone source conflicts with canonical content: ${conflicts
          .map((row) => `${row.sourceId}:${row.externalId}`)
          .join(", ")}`,
      );
    }

    await tx`
      with incoming as (
        select * from jsonb_to_recordset(${tx.json(payload)}::jsonb) as value(
          source_id integer,
          kind text,
          external_id text,
          title text,
          body text,
          frontmatter text,
          url text,
          author text,
          source_ts text,
          imported_at text,
          content_hash text
        )
      )
      insert into research_vault.sources (
        kind, external_id, title, body, frontmatter, url, author,
        source_ts, imported_at, content_hash
      )
      select
        incoming.kind::research_vault.source_kind,
        incoming.external_id,
        incoming.title,
        incoming.body,
        incoming.frontmatter,
        incoming.url,
        incoming.author,
        incoming.source_ts::timestamptz,
        incoming.imported_at::timestamptz,
        incoming.content_hash
      from incoming
      on conflict (kind, external_id) do nothing
    `;

    await tx`
      with incoming as (
        select * from jsonb_to_recordset(${tx.json(payload)}::jsonb) as value(
          source_id integer,
          kind text,
          external_id text,
          content_hash text
        )
      )
      insert into ooda.migration_records (
        run_id, entity_type, source_id, destination_table,
        destination_id, content_hash, metadata
      )
      select
        ${runId}::uuid,
        'source',
        incoming.source_id::text,
        'research_vault.sources',
        destination.id::text,
        incoming.content_hash,
        jsonb_build_object(
          'kind', incoming.kind,
          'externalId', incoming.external_id
        )
      from incoming
      join research_vault.sources destination
        on destination.kind::text = incoming.kind
       and destination.external_id = incoming.external_id
      on conflict (run_id, entity_type, source_id) do update
        set destination_id = excluded.destination_id,
            content_hash = excluded.content_hash,
            metadata = excluded.metadata,
            updated_at = now()
    `;

    const cursor = rows.at(-1)!.id.toString();
    await tx`
      update ooda.migration_runs
      set status = 'copying', phase = 'sources', cursor = ${cursor},
          last_error = null, updated_at = now()
      where id = ${runId}::uuid
    `;
  });
}

async function copyTopics(
  source: PostgresClient,
  target: PostgresClient,
  runId: string,
): Promise<void> {
  const topics = await source<TopicRow[]>`
    select
      id, label, description, centroid,
      source_count as "sourceCount", created_at as "createdAt"
    from research_vault.topics
    order by id
  `;
  for (const topic of topics) {
    await target.begin(async (tx) => {
      const existing = await tx<Array<{ destinationId: string }>>`
        select destination_id
        from ooda.migration_records
        where run_id = ${runId}::uuid
          and entity_type = 'topic'
          and source_id = ${topic.id.toString()}
        limit 1
      `;
      if (existing.length > 0) return;
      const [inserted] = await tx<Array<{ id: number }>>`
        insert into research_vault.topics (
          label, description, centroid, source_count, created_at
        ) values (
          ${topic.label}, ${topic.description}, ${topic.centroid},
          ${topic.sourceCount}, ${topic.createdAt}
        )
        returning id
      `;
      if (!inserted) throw new Error(`Could not import topic ${topic.id}`);
      await tx`
        insert into ooda.migration_records (
          run_id, entity_type, source_id, destination_table,
          destination_id, metadata
        ) values (
          ${runId}::uuid, 'topic', ${topic.id.toString()},
          'research_vault.topics', ${inserted.id.toString()},
          ${tx.json({ label: topic.label })}
        )
      `;
    });
  }
  await target`
    update ooda.migration_runs
    set phase = 'topics', updated_at = now()
    where id = ${runId}::uuid
  `;
}

async function copySourceTopics(
  source: PostgresClient,
  target: PostgresClient,
  runId: string,
): Promise<void> {
  const rows = await source<SourceTopicRow[]>`
    select source_id as "sourceId", topic_id as "topicId", score
    from research_vault.source_topics
    order by source_id, topic_id
  `;
  const payload = rows.map((row) => ({
    source_id: row.sourceId,
    topic_id: row.topicId,
    score: row.score,
  }));
  await target.begin(async (tx) => {
    await tx`
      with incoming as (
        select * from jsonb_to_recordset(${tx.json(payload)}::jsonb) as value(
          source_id integer, topic_id integer, score real
        )
      ), mapped as (
        select
          incoming.source_id,
          incoming.topic_id,
          incoming.score,
          source_record.destination_id::integer as destination_source_id,
          topic_record.destination_id::integer as destination_topic_id
        from incoming
        join ooda.migration_records source_record
          on source_record.run_id = ${runId}::uuid
         and source_record.entity_type = 'source'
         and source_record.source_id = incoming.source_id::text
        join ooda.migration_records topic_record
          on topic_record.run_id = ${runId}::uuid
         and topic_record.entity_type = 'topic'
         and topic_record.source_id = incoming.topic_id::text
      )
      insert into research_vault.source_topics (source_id, topic_id, score)
      select destination_source_id, destination_topic_id, score from mapped
      on conflict (source_id, topic_id) do update set score = excluded.score
    `;
    await tx`
      with incoming as (
        select * from jsonb_to_recordset(${tx.json(payload)}::jsonb) as value(
          source_id integer, topic_id integer, score real
        )
      ), mapped as (
        select
          incoming.*,
          source_record.destination_id as destination_source_id,
          topic_record.destination_id as destination_topic_id
        from incoming
        join ooda.migration_records source_record
          on source_record.run_id = ${runId}::uuid
         and source_record.entity_type = 'source'
         and source_record.source_id = incoming.source_id::text
        join ooda.migration_records topic_record
          on topic_record.run_id = ${runId}::uuid
         and topic_record.entity_type = 'topic'
         and topic_record.source_id = incoming.topic_id::text
      )
      insert into ooda.migration_records (
        run_id, entity_type, source_id, destination_table,
        destination_id, metadata
      )
      select
        ${runId}::uuid,
        'source_topic',
        mapped.source_id::text || ':' || mapped.topic_id::text,
        'research_vault.source_topics',
        mapped.destination_source_id || ':' || mapped.destination_topic_id,
        jsonb_build_object('score', mapped.score)
      from mapped
      on conflict (run_id, entity_type, source_id) do update
        set destination_id = excluded.destination_id,
            metadata = excluded.metadata,
            updated_at = now()
    `;
    await tx`
      update ooda.migration_runs
      set status = 'embedding', phase = 'embedding', cursor = null,
          updated_at = now()
      where id = ${runId}::uuid
    `;
  });
}

export async function copyStandaloneVault(
  source: PostgresClient,
  target: PostgresClient,
  ownerId: string,
  options: {
    batchSize?: number;
    maxSources?: number;
    onProgress?: (message: string) => void;
  } = {},
): Promise<StandaloneVaultVerification> {
  const inventory = await inventoryStandaloneVault(source);
  const run = await getOrCreateRun(target, ownerId, inventory);
  const batchSize = options.batchSize ?? 500;
  let cursor = Number(run.cursor ?? 0);
  let processed = 0;
  try {
    while (processed < (options.maxSources ?? Number.POSITIVE_INFINITY)) {
      const limit = Math.min(
        batchSize,
        (options.maxSources ?? Number.POSITIVE_INFINITY) - processed,
      );
      const rows = await source<SourceRow[]>`
        select
          id, kind::text as kind, external_id as "externalId", title, body,
          frontmatter, url, author, source_ts as "sourceTs",
          imported_at as "importedAt", content_hash as "contentHash"
        from research_vault.sources
        where id > ${cursor}
        order by id
        limit ${limit}
      `;
      if (rows.length === 0) break;
      await copySourceBatch(target, run.id, rows);
      cursor = rows.at(-1)!.id;
      processed += rows.length;
      options.onProgress?.(
        `Copied ${processed} sources through source id ${cursor}`,
      );
    }
    if (options.maxSources && processed >= options.maxSources) {
      return verifyStandaloneVault(source, target, run.id, inventory);
    }
    await copyTopics(source, target, run.id);
    await copySourceTopics(source, target, run.id);
    return verifyStandaloneVault(source, target, run.id, inventory);
  } catch (error) {
    await target`
      update ooda.migration_runs
      set status = 'failed', last_error = ${
        error instanceof Error ? error.message : String(error)
      }, updated_at = now()
      where id = ${run.id}::uuid
    `;
    throw error;
  }
}

export async function verifyStandaloneVault(
  source: PostgresClient,
  target: PostgresClient,
  runId: string,
  existingInventory?: StandaloneVaultInventory,
  embeddingModel = "nomic-embed-text",
): Promise<StandaloneVaultVerification> {
  const inventory =
    existingInventory ?? (await inventoryStandaloneVault(source));
  const [destination] = await target<
    Array<{
      sources: number;
      topics: number;
      sourceTopics: number;
      nativeEmbeddings: number;
      sourceHash: string;
    }>
  >`
    select
      count(*) filter (where records.entity_type = 'source')::int as sources,
      count(*) filter (where records.entity_type = 'topic')::int as topics,
      count(*) filter (where records.entity_type = 'source_topic')::int as "sourceTopics",
      (
        select count(*)::int
        from ooda.migration_records source_records
        join research_vault.source_embedding embeddings
          on embeddings.source_id = source_records.destination_id::integer
        where source_records.run_id = ${runId}::uuid
          and source_records.entity_type = 'source'
          and embeddings.model = ${embeddingModel}
      ) as "nativeEmbeddings",
      (
        select md5(coalesce(string_agg(
          source_records.source_id || ':' || sources.content_hash,
          ',' order by source_records.source_id::integer
        ), ''))
        from ooda.migration_records source_records
        join research_vault.sources sources
          on sources.id = source_records.destination_id::integer
        where source_records.run_id = ${runId}::uuid
          and source_records.entity_type = 'source'
      ) as "sourceHash"
    from ooda.migration_records records
    where records.run_id = ${runId}::uuid
  `;
  if (!destination) throw new Error(`Migration run ${runId} has no ledger row`);
  const destinationWithModel = { ...destination, embeddingModel };
  const checks = {
    sources: destination.sources === inventory.sources,
    topics: destination.topics === inventory.topics,
    sourceTopics: destination.sourceTopics === inventory.sourceTopics,
    sourceHash: destination.sourceHash === inventory.sourceHash,
    nativeEmbeddings:
      destinationWithModel.nativeEmbeddings === inventory.sources,
  };
  const receipt = {
    runId,
    source: inventory,
    destination: destinationWithModel,
    checks,
    copyOk:
      checks.sources &&
      checks.topics &&
      checks.sourceTopics &&
      checks.sourceHash,
    embeddingComplete: checks.nativeEmbeddings,
  };
  await target`
    update ooda.migration_runs
    set destination_counts = ${target.json({
      sources: destinationWithModel.sources,
      topics: destinationWithModel.topics,
      sourceTopics: destinationWithModel.sourceTopics,
      nativeEmbeddings: destinationWithModel.nativeEmbeddings,
    })},
        verification = ${target.json(receipt)},
        status = ${receipt.copyOk && receipt.embeddingComplete ? "completed" : "embedding"}::ooda.migration_run_status,
        phase = ${receipt.copyOk && receipt.embeddingComplete ? "completed" : "embedding"},
        completed_at = ${receipt.copyOk && receipt.embeddingComplete ? new Date() : null},
        updated_at = now()
    where id = ${runId}::uuid
  `;
  return receipt;
}

async function requestOllamaEmbeddings(
  baseUrl: string,
  model: string,
  inputs: string[],
  fetchFn: typeof fetch,
): Promise<number[][]> {
  const response = await fetchFn(`${baseUrl.replace(/\/$/, "")}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!response.ok) {
    throw new Error(
      `Ollama embedding request failed (${response.status}): ${await response.text()}`,
    );
  }
  return parseOllamaEmbeddings(await response.json(), inputs.length);
}

export async function backfillStandaloneVaultEmbeddings(
  source: PostgresClient,
  target: PostgresClient,
  runId: string,
  options: {
    baseUrl?: string;
    model?: string;
    batchSize?: number;
    maxSources?: number;
    fetch?: typeof fetch;
    onProgress?: (message: string) => void;
  } = {},
): Promise<StandaloneVaultVerification> {
  const model = options.model ?? "nomic-embed-text";
  const batchSize = options.batchSize ?? 32;
  const fetchFn = options.fetch ?? fetch;
  let embedded = 0;
  try {
    while (embedded < (options.maxSources ?? Number.POSITIVE_INFINITY)) {
      const limit = Math.min(
        batchSize,
        (options.maxSources ?? Number.POSITIVE_INFINITY) - embedded,
      );
      const rows = await target<
        Array<{
          legacySourceId: number;
          sourceId: number;
        }>
      >`
        select
          records.source_id::integer as "legacySourceId",
          sources.id as "sourceId"
        from ooda.migration_records records
        join research_vault.sources sources
          on sources.id = records.destination_id::integer
        left join research_vault.source_embedding embeddings
          on embeddings.source_id = sources.id
         and embeddings.model = ${model}
        where records.run_id = ${runId}::uuid
          and records.entity_type = 'source'
          and embeddings.source_id is null
        order by records.source_id::integer
        limit ${limit}
      `;
      if (rows.length === 0) break;

      const legacyRows = await source<
        Array<{ sourceId: number; dimensions: number; vector: Uint8Array }>
      >`
        with requested as (
          select *
          from jsonb_to_recordset(${source.json(
            rows.map((row) => ({ source_id: row.legacySourceId })),
          )}::jsonb) as value(source_id integer)
        )
        select
          embeddings.source_id as "sourceId",
          embeddings.dim as dimensions,
          embeddings.vec as vector
        from research_vault.embeddings embeddings
        join requested on requested.source_id = embeddings.source_id
        where embeddings.model = ${model}
      `;
      const legacyBySourceId = new Map(
        legacyRows.map((row) => [row.sourceId, row] as const),
      );
      const missingRows = rows.filter(
        (row) => !legacyBySourceId.has(row.legacySourceId),
      );
      const missingDetails =
        missingRows.length > 0
          ? await target<
              Array<{
                legacySourceId: number;
                title: string | null;
                body: string;
              }>
            >`
              with requested as (
                select *
                from jsonb_to_recordset(${target.json(missingRows)}::jsonb)
                  as value("legacySourceId" integer, "sourceId" integer)
              )
              select
                requested."legacySourceId" as "legacySourceId",
                sources.title,
                sources.body
              from requested
              join research_vault.sources sources
                on sources.id = requested."sourceId"
              order by requested."legacySourceId"
            `
          : [];
      if (missingDetails.length !== missingRows.length) {
        throw new Error("Could not load every source missing a legacy embedding");
      }
      const generatedVectors =
        missingDetails.length > 0
          ? await requestOllamaEmbeddings(
              options.baseUrl ?? "http://127.0.0.1:11434",
              model,
              missingDetails.map((row) =>
                buildStandaloneEmbeddingInput(row.title, row.body),
              ),
              fetchFn,
            )
          : [];
      const generatedBySourceId = new Map(
        missingDetails.map(
          (row, index) => [row.legacySourceId, generatedVectors[index]!] as const,
        ),
      );
      const payload = rows.map((row) => {
        const legacy = legacyBySourceId.get(row.legacySourceId);
        const vector = legacy
          ? parseLegacyFloat32Embedding(legacy.vector, legacy.dimensions)
          : generatedBySourceId.get(row.legacySourceId)!;
        return {
          source_id: row.sourceId,
          embedding: `[${vector.join(",")}]`,
        };
      });
      await target`
        with incoming as (
          select * from jsonb_to_recordset(${target.json(payload)}::jsonb) as value(
            source_id integer, embedding text
          )
        )
        insert into research_vault.source_embedding (
          source_id, model, embedding
        )
        select source_id, ${model}, embedding::vector(768)
        from incoming
        on conflict (source_id, model) do nothing
      `;
      embedded += rows.length;
      options.onProgress?.(`Embedded ${embedded} sources with ${model}`);
    }
    return verifyStandaloneVault(source, target, runId, undefined, model);
  } catch (error) {
    await target`
      update ooda.migration_runs
      set status = 'failed', last_error = ${
        error instanceof Error ? error.message : String(error)
      }, updated_at = now()
      where id = ${runId}::uuid
    `;
    throw error;
  }
}
