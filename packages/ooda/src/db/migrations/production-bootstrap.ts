import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

export type PostgresClient = ReturnType<typeof postgres>;

export type MigrationDescriptor = {
  idx: number;
  tag: string;
  hash: string;
  when: number;
  statements: string[];
};

export type MigrationLedgerEntry = {
  idx: number;
  tag: string;
  hash: string;
  baselineAdopted: boolean;
};

export type BaselineLandmarks = Record<string, boolean>;

export type BootstrapSnapshot = {
  database: string;
  currentUser: string;
  serverVersion: string;
  vectorVersion: string | null;
  oodaSchemaExists: boolean;
  ledgerExists: boolean;
  ledger: MigrationLedgerEntry[];
  baselineLandmarks: BaselineLandmarks;
  appRole: string;
  appRoleExists: boolean;
};

export type BootstrapPlan = {
  mode: "fresh" | "resume" | "complete" | "blocked";
  baselineAdoptions: MigrationDescriptor[];
  pending: MigrationDescriptor[];
  problems: string[];
};

export type ApplyGuard = {
  confirmation: string;
  backupSha256: string;
};

const BASELINE_LAST_INDEX = 5;
const FIRST_OODA_INDEX = 6;
const MIGRATION_LOCK = "ooda-personal-os-production-bootstrap-v1";
const ROLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function migrationDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../drizzle");
}

export function loadMigrationManifest(
  directory = migrationDirectory(),
): MigrationDescriptor[] {
  const journal = JSON.parse(
    readFileSync(resolve(directory, "meta/_journal.json"), "utf8"),
  ) as {
    entries: Array<{
      idx: number;
      tag: string;
      when: number;
    }>;
  };

  return journal.entries.map((entry) => {
    const contents = readFileSync(
      resolve(directory, `${entry.tag}.sql`),
      "utf8",
    );
    return {
      ...entry,
      hash: createHash("sha256").update(contents).digest("hex"),
      statements: contents
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    };
  });
}

function validateManifest(migrations: MigrationDescriptor[]): string[] {
  const problems: string[] = [];
  for (const [position, migration] of migrations.entries()) {
    if (migration.idx !== position) {
      problems.push(
        `Migration manifest has a gap at ${position}; found ${migration.idx}`,
      );
    }
  }
  if (!migrations[FIRST_OODA_INDEX]) {
    problems.push("Migration manifest does not contain OODA migration 0006");
  }
  return problems;
}

export function buildBootstrapPlan(
  snapshot: BootstrapSnapshot,
  migrations: MigrationDescriptor[],
): BootstrapPlan {
  const problems = validateManifest(migrations);

  if (!snapshot.vectorVersion) {
    problems.push("The pgvector extension is not installed");
  }
  if (!snapshot.appRoleExists) {
    problems.push(`Application role does not exist: ${snapshot.appRole}`);
  }

  const ledger = [...snapshot.ledger].sort(
    (left, right) => left.idx - right.idx,
  );
  for (const [position, entry] of ledger.entries()) {
    if (entry.idx !== position) {
      problems.push(
        `OODA migration ledger has a gap at ${position}; found ${entry.idx}`,
      );
    }
    const expected = migrations[entry.idx];
    if (!expected) {
      problems.push(
        `OODA migration ledger contains unknown index ${entry.idx}`,
      );
      continue;
    }
    if (entry.tag !== expected.tag) {
      problems.push(
        `OODA migration tag drift at ${entry.idx}: ${entry.tag} != ${expected.tag}`,
      );
    }
    if (entry.hash !== expected.hash) {
      problems.push(`OODA migration hash drift at ${entry.idx}: ${entry.tag}`);
    }
    if (entry.idx <= BASELINE_LAST_INDEX && !entry.baselineAdopted) {
      problems.push(
        `Legacy migration ${entry.tag} was not recorded as adopted`,
      );
    }
  }

  if (!snapshot.ledgerExists) {
    for (const [landmark, present] of Object.entries(
      snapshot.baselineLandmarks,
    )) {
      if (!present) {
        problems.push(`Legacy baseline landmark is missing: ${landmark}`);
      }
    }
  }

  if (snapshot.oodaSchemaExists && !snapshot.ledgerExists) {
    problems.push("The ooda schema exists without an OODA migration ledger");
  }
  if (
    !snapshot.oodaSchemaExists &&
    ledger.some((entry) => entry.idx >= FIRST_OODA_INDEX)
  ) {
    problems.push(
      "The OODA migration ledger claims applied OODA schema changes",
    );
  }
  if (
    snapshot.oodaSchemaExists &&
    ledger.length > 0 &&
    ledger.every((entry) => entry.idx <= BASELINE_LAST_INDEX)
  ) {
    problems.push("The ooda schema exists but migration 0006 is not recorded");
  }

  const highestApplied = ledger.at(-1)?.idx ?? -1;
  const baselineAdoptions = snapshot.ledgerExists
    ? []
    : migrations.slice(0, FIRST_OODA_INDEX);
  const pending = migrations.filter(
    (migration) =>
      migration.idx >= FIRST_OODA_INDEX && migration.idx > highestApplied,
  );

  if (problems.length > 0) {
    return { mode: "blocked", baselineAdoptions, pending, problems };
  }
  if (!snapshot.ledgerExists) {
    return { mode: "fresh", baselineAdoptions, pending, problems };
  }
  if (pending.length > 0) {
    return { mode: "resume", baselineAdoptions, pending, problems };
  }
  return { mode: "complete", baselineAdoptions, pending, problems };
}

export function confirmationFor(
  snapshot: BootstrapSnapshot,
  plan: BootstrapPlan,
): string {
  const target =
    plan.pending.at(-1)?.tag ?? snapshot.ledger.at(-1)?.tag ?? "no-migrations";
  return `APPLY-OODA-PERSONAL-OS:${snapshot.database}:${target}`;
}

export function validateApplyGuard(
  snapshot: BootstrapSnapshot,
  plan: BootstrapPlan,
  guard: ApplyGuard,
): void {
  if (plan.mode === "blocked") {
    throw new Error(`Bootstrap is blocked: ${plan.problems.join("; ")}`);
  }
  const expected = confirmationFor(snapshot, plan);
  if (guard.confirmation !== expected) {
    throw new Error(`Invalid confirmation; expected ${expected}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(guard.backupSha256)) {
    throw new Error("A valid fresh backup SHA-256 is required");
  }
}

export async function inspectBootstrap(
  sql: PostgresClient,
  appRole: string,
): Promise<BootstrapSnapshot> {
  if (!ROLE_PATTERN.test(appRole)) throw new Error("Invalid application role");

  const [identity] = await sql<
    Array<{
      database: string;
      currentUser: string;
      serverVersion: string;
      vectorVersion: string | null;
      oodaSchemaExists: boolean;
      ledgerExists: boolean;
      appRoleExists: boolean;
    }>
  >`
    select
      current_database() as "database",
      current_user as "currentUser",
      current_setting('server_version') as "serverVersion",
      (select extversion from pg_extension where extname = 'vector') as "vectorVersion",
      to_regnamespace('ooda') is not null as "oodaSchemaExists",
      to_regclass('ooda_migrations.migrations') is not null as "ledgerExists",
      exists(select 1 from pg_roles where rolname = ${appRole}) as "appRoleExists"
  `;
  if (!identity) throw new Error("Could not inspect database identity");

  const [landmarks] = await sql<Array<Record<string, boolean>>>`
    select
      to_regclass('public.research_thread') is not null as "research_thread",
      to_regclass('public.runner_session') is not null as "runner_session",
      to_regclass('public.session_event') is not null as "session_event",
      to_regclass('personal_vault.sources') is not null as "personal_vault_sources",
      to_regclass('research_vault.sources') is not null as "research_vault_sources",
      to_regclass('public.graph_exploration') is not null as "graph_exploration",
      exists(
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'thread_memory'
          and column_name = 'embedding_model'
      ) as "thread_memory_embedding_model",
      to_regclass('public.graph_exploration_thread_id_idx') is not null
        as "graph_exploration_thread_id_idx"
  `;

  let ledger: MigrationLedgerEntry[] = [];
  if (identity.ledgerExists) {
    ledger = await sql<MigrationLedgerEntry[]>`
      select
        idx,
        tag,
        code_hash as "hash",
        baseline_adopted as "baselineAdopted"
      from ooda_migrations.migrations
      order by idx
    `;
  }

  return {
    ...identity,
    appRole,
    baselineLandmarks: landmarks ?? {},
    ledger,
  };
}

async function initializeLedger(
  sql: PostgresClient,
  baseline: MigrationDescriptor[],
  backupSha256: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`create schema "ooda_migrations"`);
    await tx.unsafe(`
      create table "ooda_migrations"."migrations" (
        "idx" integer primary key,
        "tag" text not null unique,
        "code_hash" text not null,
        "journal_timestamp" bigint not null,
        "baseline_adopted" boolean not null default false,
        "backup_sha256" text not null,
        "applied_by" text not null default current_user,
        "applied_at" timestamptz not null default now()
      )
    `);
    for (const migration of baseline) {
      await tx`
        insert into ooda_migrations.migrations (
          idx, tag, code_hash, journal_timestamp, baseline_adopted, backup_sha256
        ) values (
          ${migration.idx}, ${migration.tag}, ${migration.hash}, ${migration.when},
          true, ${backupSha256}
        )
      `;
    }
  });
}

async function applyOneMigration(
  sql: PostgresClient,
  migration: MigrationDescriptor,
  backupSha256: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const statement of migration.statements) {
      await tx.unsafe(statement);
    }
    await tx`
      insert into ooda_migrations.migrations (
        idx, tag, code_hash, journal_timestamp, baseline_adopted, backup_sha256
      ) values (
        ${migration.idx}, ${migration.tag}, ${migration.hash}, ${migration.when},
        false, ${backupSha256}
      )
    `;
  });
}

async function reconcileAppPrivileges(
  sql: PostgresClient,
  appRole: string,
): Promise<void> {
  if (!ROLE_PATTERN.test(appRole)) throw new Error("Invalid application role");
  const role = `"${appRole}"`;
  await sql.begin(async (tx) => {
    for (const schema of ["ooda", "personal_vault", "research_vault"]) {
      const quotedSchema = `"${schema}"`;
      await tx.unsafe(`grant usage on schema ${quotedSchema} to ${role}`);
      await tx.unsafe(
        `grant select, insert, update, delete on all tables in schema ${quotedSchema} to ${role}`,
      );
      await tx.unsafe(
        `grant usage, select, update on all sequences in schema ${quotedSchema} to ${role}`,
      );
      await tx.unsafe(
        `alter default privileges in schema ${quotedSchema} grant select, insert, update, delete on tables to ${role}`,
      );
      await tx.unsafe(
        `alter default privileges in schema ${quotedSchema} grant usage, select, update on sequences to ${role}`,
      );
    }
  });
}

export async function applyProductionBootstrap(input: {
  sql: PostgresClient;
  appRole: string;
  migrations?: MigrationDescriptor[];
  guard: ApplyGuard;
}): Promise<{ before: BootstrapSnapshot; after: BootstrapSnapshot }> {
  const migrations = input.migrations ?? loadMigrationManifest();
  await input.sql`select pg_advisory_lock(hashtext(${MIGRATION_LOCK}))`;
  try {
    const before = await inspectBootstrap(input.sql, input.appRole);
    const plan = buildBootstrapPlan(before, migrations);
    validateApplyGuard(before, plan, input.guard);

    if (!before.ledgerExists) {
      await initializeLedger(
        input.sql,
        plan.baselineAdoptions,
        input.guard.backupSha256,
      );
    }
    for (const migration of plan.pending) {
      await applyOneMigration(input.sql, migration, input.guard.backupSha256);
    }
    await reconcileAppPrivileges(input.sql, input.appRole);

    const after = await inspectBootstrap(input.sql, input.appRole);
    const afterPlan = buildBootstrapPlan(after, migrations);
    if (afterPlan.mode !== "complete") {
      throw new Error(
        `Bootstrap did not complete: ${afterPlan.problems.join("; ")}`,
      );
    }
    return { before, after };
  } finally {
    await input.sql`select pg_advisory_unlock(hashtext(${MIGRATION_LOCK}))`;
  }
}
