import postgres from "postgres";

import {
  applyProductionBootstrap,
  buildBootstrapPlan,
  confirmationFor,
  inspectBootstrap,
  loadMigrationManifest,
} from "../src/db/migrations/production-bootstrap";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing DATABASE_URL");

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.split("=");
    return [key, value.join("=")];
  }),
);
const apply = args.has("--apply");
const appRole = args.get("--app-role") || process.env.OODA_APP_ROLE || "bob";
const confirmation = args.get("--confirm") ?? "";
const backupSha256 = args.get("--backup-sha256") ?? "";
const migrations = loadMigrationManifest();
const sql = postgres(databaseUrl, { max: 1 });

try {
  const snapshot = await inspectBootstrap(sql, appRole);
  const plan = buildBootstrapPlan(snapshot, migrations);
  const report = {
    target: {
      database: snapshot.database,
      currentUser: snapshot.currentUser,
      serverVersion: snapshot.serverVersion,
      vectorVersion: snapshot.vectorVersion,
      appRole: snapshot.appRole,
      appRoleExists: snapshot.appRoleExists,
    },
    state: {
      oodaSchemaExists: snapshot.oodaSchemaExists,
      ledgerExists: snapshot.ledgerExists,
      applied: snapshot.ledger.map((entry) => entry.tag),
      baselineLandmarks: snapshot.baselineLandmarks,
    },
    plan: {
      mode: plan.mode,
      baselineAdoptions: plan.baselineAdoptions.map(
        (migration) => migration.tag,
      ),
      pending: plan.pending.map((migration) => migration.tag),
      problems: plan.problems,
    },
    applyGuard: {
      expectedConfirmation: confirmationFor(snapshot, plan),
      freshBackupSha256Required: true,
    },
  };

  if (!apply) {
    console.log(JSON.stringify(report, null, 2));
    if (plan.mode === "blocked") process.exitCode = 1;
  } else {
    const result = await applyProductionBootstrap({
      sql,
      appRole,
      migrations,
      guard: { confirmation, backupSha256 },
    });
    console.log(
      JSON.stringify(
        {
          ...report,
          result: {
            beforeApplied: result.before.ledger.length,
            afterApplied: result.after.ledger.length,
            oodaSchemaExists: result.after.oodaSchemaExists,
            status: "complete",
          },
        },
        null,
        2,
      ),
    );
  }
} finally {
  await sql.end();
}
