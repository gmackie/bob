/**
 * Build-time generation of Bob's OpenAPI 3.1 spec from the Effect-RPC contract
 * groups. Writes the canonical, committed artifact consumed by:
 *   - apps/bob's GET /api/openapi.json route (static import, edge-safe), and
 *   - openapi-typescript (→ packages/bob-client/src/schema.d.ts).
 *
 * Run: pnpm generate:openapi:bob
 *
 * This imports the light `bob-rpc-groups` module (contracts + effect only), so
 * no DB/auth/env setup is needed — unlike the tRPC generator.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

async function main() {
  const { generateBobRpcApiDocument } = await import(
    "../packages/bob/src/api/src/contracts/bob-rpc-groups.ts"
  );

  const spec = generateBobRpcApiDocument({ baseUrl: "https://blder.bot" });

  const outDir = join(root, "packages", "bob-client", "openapi");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "bob.json");
  writeFileSync(outFile, `${JSON.stringify(spec, null, 2)}\n`);

  const pathCount = Object.keys(spec.paths ?? {}).length;
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${pathCount} Bob paths → packages/bob-client/openapi/bob.json`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
