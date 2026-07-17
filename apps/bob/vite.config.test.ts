import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { getResolveAliases } from "./vite.aliases";

test("node target resolves postgres to the Node entrypoint", () => {
  const aliases = getResolveAliases("node");
  const dirname = path.dirname(fileURLToPath(import.meta.url));

  assert.equal(
    aliases["postgres"],
    path.resolve(dirname, "node_modules/postgres/src/index.js"),
  );
  assert.equal(
    aliases["@bob/db/client"],
    path.resolve(dirname, "src/lib/db-client-lazy.ts"),
  );
});
