import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { bundledServerEnvironment, verifyBundledResources, writeBundledResourceManifest } from "./bundled-resources.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "Bob Install With Spaces ")); roots.push(root);
  const resources = path.join(root, "Bob v1.app", "Contents", "Resources");
  for (const file of ["bob-server/dist/bin.js", "bob-server/dist/server.js", "blder/package.json", "blder/node_modules/vinext/dist/cli.js", "blder/dist/server/index.js", "db-migrations/meta/_journal.json", "db-migrations/0001.sql", "blder/dist/client/assets/app.js"]) {
    fs.mkdirSync(path.dirname(path.join(resources, file)), { recursive: true });
    fs.writeFileSync(path.join(resources, file), "fixture");
  }
  writeBundledResourceManifest(resources);
  return { root, resources };
}
it("validates resources after relocation/update with spaces", () => {
  const { root, resources } = fixture();
  verifyBundledResources(resources);
  const updated = path.join(root, "Bob v2.app");
  fs.renameSync(path.join(root, "Bob v1.app"), updated);
  verifyBundledResources(path.join(updated, "Contents", "Resources"));
});
it.each(["bob-server/dist/bin.js", "blder/node_modules/vinext/dist/cli.js", "db-migrations/0001.sql", "blder/dist/client/assets/app.js", "runtime-resources.json"])("identifies missing or corrupt %s", (file) => {
  const { resources } = fixture();
  fs.appendFileSync(path.join(resources, file), "broken");
  expect(() => verifyBundledResources(resources)).toThrow(`Bundled Bob resource is missing or corrupt: ${file}. Reinstall Bob`);
  fs.unlinkSync(path.join(resources, file));
  expect(() => verifyBundledResources(resources)).toThrow(`Bundled Bob resource is missing or corrupt: ${file}. Reinstall Bob`);
});
it("pins packaged runtime paths despite inherited development or old-install overrides", () => {
  const resources = "/Applications/Bob Updated.app/Contents/Resources";
  const executable = "/Applications/Bob Updated.app/Contents/MacOS/Bob";
  const env = bundledServerEnvironment(resources, executable, { PATH: "", BOB_NODE: "node", BOB_DESKTOP_DEV: "1", BOB_VINEXT_CLI: "/old/app/cli.js", BOB_BLDER_DIR: "/old/app", BOB_DB_MIGRATIONS_DIR: "/old/db" });
  expect(env).toMatchObject({ PATH: "", BOB_NODE: executable, ELECTRON_RUN_AS_NODE: "1", BOB_DESKTOP_DEV: "0", BOB_BLDER_DIR: path.join(resources, "blder"), BOB_VINEXT_CLI: path.join(resources, "blder/node_modules/vinext/dist/cli.js"), BOB_DB_MIGRATIONS_DIR: path.join(resources, "db-migrations") });
});
