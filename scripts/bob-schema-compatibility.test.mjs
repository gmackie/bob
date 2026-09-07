import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import * as schema from "../packages/bob/src/db/src/schema.ts";

// Resolve the schema package's declared ORM dependency, not a root hoist.
const require = createRequire(
  new URL("../packages/bob/src/schema/package.json", import.meta.url),
);
const { is, Table, getTableName } = require("drizzle-orm");
const { getTableConfig } = require("drizzle-orm/pg-core");

const areas = [
  "agents",
  "auth",
  "chat",
  "ci",
  "cookies",
  "git",
  "notifications",
  "projects",
  "secrets",
  "settings",
  "tenancy",
  "webhooks",
  "work-items",
];

test("all domain compatibility exports retain the canonical schema object identity", async () => {
  for (const area of areas) {
    const canonical = await import(`../packages/bob/src/schema/src/${area}.ts`);
    const compatibility = await import(
      `../packages/bob/src/${area}/src/schema.ts`
    );
    assert.deepEqual(Object.keys(compatibility), Object.keys(canonical));
    for (const [name, value] of Object.entries(canonical)) {
      assert.equal(
        compatibility[name],
        value,
        `${area}/${name} compatibility identity`,
      );
      assert.equal(schema[name], value, `${area}/${name} aggregate identity`);
    }
  }
});

test("aggregate table names have one identity and foreign keys target compatible columns", () => {
  const tables = new Map();
  for (const value of Object.values(schema)) {
    if (!is(value, Table)) continue;
    const name = getTableName(value);
    if (tables.has(name))
      assert.equal(tables.get(name), value, `duplicate table ${name}`);
    tables.set(name, value);
  }
  assert.ok(tables.size > 50, "full Bob schema must be present");
  for (const [name, table] of tables) {
    for (const foreignKey of getTableConfig(table).foreignKeys) {
      const { foreignTable, foreignColumns } = foreignKey.reference();
      const target = tables.get(getTableName(foreignTable));
      assert.ok(target, `${name} foreign key target must exist`);
      // Shared core tables can reference their own adapter for the same SQL
      // table (agent_personas -> tenants). Compare the actual referenced SQL
      // columns; requiring adapter object identity would reject a valid FK.
      const columns = getTableConfig(target).columns;
      for (const foreignColumn of foreignColumns) {
        const column = columns.find(
          (candidate) => candidate.name === foreignColumn.name,
        );
        assert.ok(column, `${name} foreign key target column must exist`);
        assert.equal(column.getSQLType(), foreignColumn.getSQLType());
      }
    }
  }
});
