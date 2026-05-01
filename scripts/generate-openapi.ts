import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

async function main() {
  const outDir = join(root, "dist", "openapi");
  mkdirSync(outDir, { recursive: true });

  // ---- OODA spec ----
  // The OODA router imports db/client.ts which requires DATABASE_URL at
  // module-load time.  We only need the router *shape* (metadata) for
  // OpenAPI generation — no actual DB connection is made — so provide a
  // harmless placeholder when the var is absent.
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgres://openapi-gen:unused@localhost:5432/unused";
  }

  const { generateOodaOpenApiDocument } = await import(
    "../packages/ooda/src/api/openapi.ts"
  );
  const oodaSpec = generateOodaOpenApiDocument({
    baseUrl: "https://ooda.blder.bot",
  });
  writeFileSync(
    join(outDir, "ooda.json"),
    JSON.stringify(oodaSpec, null, 2),
  );
  console.log(
    `Wrote ${Object.keys(oodaSpec.paths ?? {}).length} OODA paths → dist/openapi/ooda.json`,
  );

  // ---- Bob spec ----
  // TODO: Bob's @bob/api/openapi exports `generateFullBobApiDocument` which
  // requires the appRouter instance as its first argument, and the import
  // chain pulls in @bob/auth, @bob/db, @bob/config, @bob/execution, etc.
  // These have their own runtime requirements (env vars, native modules)
  // that make a standalone build-script import non-trivial.  Wire this up
  // once Bob's dependency tree is refactored for tree-shakeable metadata
  // imports, or run it inside the bob-server process instead.
  //
  // Usage would be:
  //   const { generateFullBobApiDocument } = await import(
  //     "../packages/bob/src/api/src/openapi.ts"
  //   );
  //   const { appRouter } = await import("../packages/bob/src/api/src/index.ts");
  //   const bobSpec = generateFullBobApiDocument(appRouter._def.record, {
  //     baseUrl: "https://bob.blder.bot",
  //   });
  //   writeFileSync(join(outDir, "bob.json"), JSON.stringify(bobSpec, null, 2));
  //   console.log(
  //     `Wrote ${Object.keys(bobSpec.paths ?? {}).length} Bob paths → dist/openapi/bob.json`,
  //   );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
