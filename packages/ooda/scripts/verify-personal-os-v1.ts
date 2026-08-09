import postgres from "postgres";

import { verifyLegacyResearchBackfill } from "../src/db/migrations/personal-os-v1";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing DATABASE_URL");

const sql = postgres(databaseUrl, { max: 1 });
try {
  const receipt = await verifyLegacyResearchBackfill(sql);
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.ok) process.exitCode = 1;
} finally {
  await sql.end();
}
