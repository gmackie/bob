import postgres from "postgres";

export type PostgresClient = ReturnType<typeof postgres>;

export type VerificationRow = {
  check: string;
  source: string;
  destination: string;
};

export type VerificationReceipt = {
  ok: boolean;
  checks: Array<VerificationRow & { ok: boolean }>;
};

export function mapLegacySessionEvent(legacyType: string): {
  type:
    | "user_turn"
    | "assistant_turn"
    | "assistant_delta"
    | "failure"
    | "system_annotation"
    | "proposal";
  actorType: "user" | "host" | "system";
  sensitivity: "general" | "restricted";
  legacyType: string;
} {
  switch (legacyType) {
    case "prompt":
      return { type: "user_turn", actorType: "user", sensitivity: "general", legacyType };
    case "stdout":
      return { type: "assistant_turn", actorType: "host", sensitivity: "general", legacyType };
    case "stdout_chunk":
      return { type: "assistant_delta", actorType: "host", sensitivity: "general", legacyType };
    case "stderr_chunk":
    case "error":
      return { type: "failure", actorType: "system", sensitivity: "general", legacyType };
    case "thought":
      return { type: "system_annotation", actorType: "host", sensitivity: "restricted", legacyType };
    case "promotion_available":
      return { type: "proposal", actorType: "system", sensitivity: "general", legacyType };
    case "promote_request":
      return { type: "proposal", actorType: "user", sensitivity: "general", legacyType };
    default:
      return { type: "system_annotation", actorType: "system", sensitivity: "general", legacyType };
  }
}

export function parseVerificationRows(
  rows: VerificationRow[],
): VerificationReceipt {
  const checks = rows.map((row) => ({
    ...row,
    ok: row.source === row.destination,
  }));
  return { ok: checks.every((check) => check.ok), checks };
}

const BACKFILL_SQL = `
select pg_advisory_xact_lock(hashtext('ooda-personal-os-v1-backfill'));

insert into ooda.conversations (
  id, owner_id, title, status, host_provider, host_profile, last_sequence,
  sensitivity_ceiling, tts_policy, migration_metadata, created_at, updated_at
)
select
  rt.id,
  coalesce(rt.owner_id, 'legacy-unowned'),
  rt.title,
  case when rt.status::text = 'archived' then 'archived'::ooda.conversation_status
       else 'active'::ooda.conversation_status end,
  'grok',
  'legacy-research',
  1,
  'personal'::ooda.sensitivity,
  'manual'::ooda.tts_policy,
  jsonb_build_object(
    'source', 'research_thread',
    'sourceId', rt.id::text,
    'sourceSlug', rt.slug,
    'domainPackId', rt.domain_pack_id
  ),
  rt.created_at,
  coalesce(rt.updated_at, rt.created_at)
from research_thread rt
on conflict (id) do nothing;

insert into ooda.conversation_branches (
  id, conversation_id, name, reason, migration_metadata, created_at, updated_at
)
select
  rt.id,
  rt.id,
  'main',
  'Migrated root branch',
  jsonb_build_object('source', 'research_thread', 'sourceId', rt.id::text),
  rt.created_at,
  coalesce(rt.updated_at, rt.created_at)
from research_thread rt
on conflict (id) do nothing;

update ooda.conversations c
set active_branch_id = c.id
where c.active_branch_id is null
  and c.migration_metadata ->> 'source' = 'research_thread';

insert into ooda.conversation_events (
  id, conversation_id, branch_id, sequence, type, actor_type, payload,
  sensitivity, correlation_id, idempotency_key, occurred_at, recorded_at
)
select
  rt.id,
  rt.id,
  rt.id,
  1,
  'system_annotation',
  'system',
  jsonb_build_object(
    'annotation', 'Migrated legacy research thread',
    'migration', jsonb_build_object(
      'source', 'research_thread',
      'sourceId', rt.id::text,
      'sourceSlug', rt.slug
    )
  ),
  'general'::ooda.sensitivity,
  'legacy-research-thread:' || rt.id::text,
  'legacy-research-thread:' || rt.id::text,
  rt.created_at,
  rt.created_at
from research_thread rt
on conflict (id) do nothing;

insert into ooda.agent_jobs (
  id, conversation_id, class, status, provider, capabilities,
  deadline_seconds, aggregate_token_budget, correlation_id, idempotency_key,
  result, created_at, updated_at, started_at, completed_at
)
select
  rs.id,
  rs.thread_id,
  'read_only_research',
  case rs.status::text
    when 'pending' then 'queued'
    when 'running' then 'running'
    when 'completed' then 'completed'
    when 'failed' then 'failed'
    when 'cancelled' then 'cancelled'
    else 'failed'
  end,
  rs.adapter_id,
  array[]::text[],
  900,
  150000,
  'legacy-runner-session:' || rs.id::text,
  'legacy-runner-session:' || rs.id::text,
  jsonb_build_object(
    'migration', jsonb_build_object(
      'source', 'runner_session',
      'sourceId', rs.id::text,
      'runnerId', rs.runner_id::text,
      'toolProfileId', rs.tool_profile_id,
      'exitCode', rs.exit_code,
      'comparisonId', rs.comparison_id
    )
  ),
  rs.created_at,
  coalesce(rs.completed_at, rs.started_at, rs.created_at),
  rs.started_at,
  rs.completed_at
from runner_session rs
on conflict (id) do nothing;

with ordered as (
  select
    se.*,
    row_number() over (
      partition by se.session_id order by se.created_at, se.id
    )::bigint as migrated_sequence
  from session_event se
)
insert into ooda.agent_job_events (
  id, agent_job_id, sequence, type, payload, occurred_at, recorded_at
)
select
  ordered.id,
  ordered.session_id,
  ordered.migrated_sequence,
  ordered.type,
  jsonb_build_object(
    'content', ordered.content,
    'migration', jsonb_build_object(
      'source', 'session_event',
      'sourceId', ordered.id::text,
      'legacyType', ordered.type
    )
  ),
  ordered.created_at,
  ordered.created_at
from ordered
on conflict (id) do nothing;

with ordered as (
  select
    se.*,
    rs.thread_id,
    rs.adapter_id,
    rt.owner_id,
    (row_number() over (
      partition by rs.thread_id order by se.created_at, se.id
    ) + 1)::bigint as migrated_sequence
  from session_event se
  join runner_session rs on rs.id = se.session_id
  join research_thread rt on rt.id = rs.thread_id
)
insert into ooda.conversation_events (
  id, conversation_id, branch_id, sequence, type, actor_type, actor_id,
  payload, sensitivity, correlation_id, causation_id, idempotency_key,
  occurred_at, recorded_at
)
select
  ordered.id,
  ordered.thread_id,
  ordered.thread_id,
  ordered.migrated_sequence,
  case ordered.type
    when 'prompt' then 'user_turn'
    when 'stdout' then 'assistant_turn'
    when 'stdout_chunk' then 'assistant_delta'
    when 'stderr_chunk' then 'failure'
    when 'error' then 'failure'
    when 'promotion_available' then 'proposal'
    when 'promote_request' then 'proposal'
    else 'system_annotation'
  end,
  case ordered.type
    when 'prompt' then 'user'
    when 'stdout' then 'host'
    when 'stdout_chunk' then 'host'
    when 'thought' then 'host'
    when 'promote_request' then 'user'
    else 'system'
  end,
  case
    when ordered.type in ('prompt', 'promote_request') then ordered.owner_id
    when ordered.type in ('stdout', 'stdout_chunk', 'thought') then ordered.adapter_id
    else null
  end,
  jsonb_build_object(
    'content', ordered.content,
    'migration', jsonb_build_object(
      'source', 'session_event',
      'sourceId', ordered.id::text,
      'legacyType', ordered.type,
      'legacySessionId', ordered.session_id::text,
      'provider', ordered.adapter_id
    )
  ),
  case when ordered.type = 'thought'
    then 'restricted'::ooda.sensitivity
    else 'general'::ooda.sensitivity
  end,
  'legacy-runner-session:' || ordered.session_id::text,
  ordered.session_id::text,
  'legacy-session-event:' || ordered.id::text,
  ordered.created_at,
  ordered.created_at
from ordered
on conflict (id) do nothing;

update ooda.conversations c
set last_sequence = migrated.last_sequence
from (
  select
    rt.id,
    (count(se.id) + 1)::bigint as last_sequence
  from research_thread rt
  left join runner_session rs on rs.thread_id = rt.id
  left join session_event se on se.session_id = rs.id
  group by rt.id
) migrated
where c.id = migrated.id
  and c.migration_metadata ->> 'source' = 'research_thread';
`;

export async function backfillLegacyResearch(
  sql: PostgresClient,
): Promise<VerificationReceipt> {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(BACKFILL_SQL);
  });
  return verifyLegacyResearchBackfill(sql);
}

async function scalar(sql: PostgresClient, query: string): Promise<string> {
  const rows = await sql.unsafe<Array<{ value: string }>>(query);
  return rows[0]?.value ?? "";
}

export async function verifyLegacyResearchBackfill(
  sql: PostgresClient,
): Promise<VerificationReceipt> {
  const checks: VerificationRow[] = [];

  const countChecks = [
    {
      check: "conversations",
      source: "select count(*)::text as value from research_thread",
      destination:
        "select count(*)::text as value from ooda.conversations where migration_metadata ->> 'source' = 'research_thread'",
    },
    {
      check: "branches",
      source: "select count(*)::text as value from research_thread",
      destination:
        "select count(*)::text as value from ooda.conversation_branches where migration_metadata ->> 'source' = 'research_thread'",
    },
    {
      check: "agent_jobs",
      source: "select count(*)::text as value from runner_session",
      destination:
        "select count(*)::text as value from ooda.agent_jobs where result #>> '{migration,source}' = 'runner_session'",
    },
    {
      check: "conversation_events",
      source: "select count(*)::text as value from session_event",
      destination:
        "select count(*)::text as value from ooda.conversation_events where payload #>> '{migration,source}' = 'session_event'",
    },
    {
      check: "agent_job_events",
      source: "select count(*)::text as value from session_event",
      destination:
        "select count(*)::text as value from ooda.agent_job_events where payload #>> '{migration,source}' = 'session_event'",
    },
  ];

  for (const check of countChecks) {
    checks.push({
      check: check.check,
      source: await scalar(sql, check.source),
      destination: await scalar(sql, check.destination),
    });
  }

  checks.push({
    check: "transcript_hash",
    source: await scalar(
      sql,
      `select md5(coalesce(string_agg(
        se.id::text || chr(31) || se.type || chr(31) || se.content,
        chr(30) order by rs.thread_id, se.created_at, se.id
      ), '')) as value
      from session_event se
      join runner_session rs on rs.id = se.session_id`,
    ),
    destination: await scalar(
      sql,
      `select md5(coalesce(string_agg(
        (payload #>> '{migration,sourceId}') || chr(31) ||
        (payload #>> '{migration,legacyType}') || chr(31) ||
        (payload ->> 'content'),
        chr(30) order by conversation_id, sequence
      ), '')) as value
      from ooda.conversation_events
      where payload #>> '{migration,source}' = 'session_event'`,
    ),
  });

  checks.push({
    check: "last_sequence",
    source: await scalar(
      sql,
      `select md5(coalesce(string_agg(id::text || ':' || expected, ',' order by id), '')) as value
       from (
         select rt.id, (count(se.id) + 1)::text as expected
         from research_thread rt
         left join runner_session rs on rs.thread_id = rt.id
         left join session_event se on se.session_id = rs.id
         group by rt.id
       ) source_sequences`,
    ),
    destination: await scalar(
      sql,
      `select md5(coalesce(string_agg(id::text || ':' || last_sequence::text, ',' order by id), '')) as value
       from ooda.conversations
       where migration_metadata ->> 'source' = 'research_thread'`,
    ),
  });

  return parseVerificationRows(checks);
}
