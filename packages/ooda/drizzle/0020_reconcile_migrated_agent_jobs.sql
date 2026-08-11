do $migration$
begin
lock table ooda.agent_jobs, ooda.agent_job_events in share row exclusive mode;

with migrated_sequences as (
  select
    aj.id,
    greatest(aj.last_sequence, coalesce(max(aje.sequence), 0))::bigint
      as last_sequence
  from ooda.agent_jobs aj
  left join ooda.agent_job_events aje on aje.agent_job_id = aj.id
  where (aj.result #>> '{migration,source}') = 'runner_session'
  group by aj.id
)
update ooda.agent_jobs aj
set last_sequence = migrated_sequences.last_sequence
from migrated_sequences
where aj.id = migrated_sequences.id
  and aj.last_sequence <> migrated_sequences.last_sequence;

with candidates as (
  select
    aj.id,
    case rs.status::text
      when 'completed' then 'completed'
      when 'cancelled' then 'cancelled'
      else 'failed'
    end as terminal_status,
    greatest(aj.last_sequence, coalesce(max(aje.sequence), 0)) + 1
      as terminal_sequence,
    coalesce(rs.completed_at, aj.updated_at, aj.started_at, aj.created_at)
      as terminal_at,
    rs.status::text as legacy_status
  from ooda.agent_jobs aj
  join public.runner_session rs on rs.id = aj.id
  left join ooda.agent_job_events aje on aje.agent_job_id = aj.id
  where (aj.result #>> '{migration,source}') = 'runner_session'
    and aj.status = 'running'
    and aj.lease_expires_at is null
    and aj.claimed_by is null
  group by aj.id, rs.status, rs.completed_at
)
insert into ooda.agent_job_events (
  id,
  agent_job_id,
  sequence,
  type,
  payload,
  idempotency_key,
  occurred_at,
  recorded_at
)
select
  gen_random_uuid(),
  candidates.id,
  candidates.terminal_sequence,
  candidates.terminal_status,
  jsonb_build_object(
    'message', 'Reconciled a migrated runner session that had no adoptable lease',
    'migration', jsonb_build_object(
      'source', 'runner_session_reconciliation',
      'sourceId', candidates.id::text,
      'legacyStatus', candidates.legacy_status
    )
  ),
  'reconcile-migrated-runner-session:' || candidates.id::text,
  candidates.terminal_at,
  now()
from candidates
on conflict (agent_job_id, idempotency_key) do nothing;

update ooda.agent_jobs aj
set
  status = reconciliation.type,
  last_sequence = reconciliation.sequence,
  claimed_by = null,
  lease_token = null,
  lease_expires_at = null,
  last_heartbeat_at = null,
  completed_at = reconciliation.occurred_at,
  updated_at = now(),
  error = case
    when reconciliation.type = 'failed' then coalesce(
      aj.error,
      'Migrated runner session had no adoptable lease'
    )
    else aj.error
  end,
  result = coalesce(aj.result, '{}'::jsonb) || jsonb_build_object(
    'reconciliation', jsonb_build_object(
      'source', 'runner_session',
      'reason', 'running_without_lease',
      'eventId', reconciliation.id::text
    )
  )
from ooda.agent_job_events reconciliation
where reconciliation.agent_job_id = aj.id
  and reconciliation.idempotency_key =
    'reconcile-migrated-runner-session:' || aj.id::text
  and (aj.result #>> '{migration,source}') = 'runner_session'
  and aj.status = 'running'
  and aj.lease_expires_at is null
  and aj.claimed_by is null;

end
$migration$;
