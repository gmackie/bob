import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const manifestName = "runtime-resources.json";
const required = [
  "bob-server/dist/bin.js",
  "bob-server/dist/server.js",
  "blder/package.json",
  "blder/node_modules/vinext/dist/cli.js",
  "blder/dist/server/index.js",
  "db-migrations/meta/_journal.json",
];
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Hash launch code and migrations after staging, never checkout-specific paths. */
export function writeBundledResourceManifest(resources: string): void {
  const files = new Set(required);
  function collect(directory: string): void {
    for (const entry of fs.readdirSync(path.join(resources, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile()) files.add(file);
    }
  }
  collect("blder/dist");
  for (const name of fs.readdirSync(path.join(resources, "bob-server/dist"))) {
    if (name.endsWith(".js")) files.add(`bob-server/dist/${name}`);
  }
  for (const name of fs.readdirSync(path.join(resources, "db-migrations"))) {
    if (name.endsWith(".sql")) files.add(`db-migrations/${name}`);
  }
  const entries = Object.fromEntries([...files].sort().map((file) => [file, hash(path.join(resources, file))]));
  fs.writeFileSync(path.join(resources, manifestName), JSON.stringify({ version: 1, files: entries }, null, 2) + "\n");
}

export function verifyBundledResources(resources: string): void {
  let current = manifestName;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(resources, manifestName), "utf8"));
    if (manifest.version !== 1 || !manifest.files || typeof manifest.files !== "object") throw new Error("Invalid manifest");
    for (const file of required) {
      current = file;
      if (typeof manifest.files[file] !== "string") throw new Error("Missing manifest entry");
    }
    for (const [file, expected] of Object.entries(manifest.files)) {
      current = file;
      const relative = path.relative(resources, path.resolve(resources, file));
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Invalid resource path");
      if (hash(path.join(resources, file)) !== expected) throw new Error("Checksum mismatch");
    }
  } catch (cause) {
    throw new Error(`Bundled Bob resource is missing or corrupt: ${current}. Reinstall Bob and try again.`, { cause });
  }
}

/** Packaged services must use this installation, including after an update. */
export function bundledServerEnvironment(resources: string, executable: string, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...inherited,
    ELECTRON_RUN_AS_NODE: "1",
    BOB_NODE: executable,
    BOB_DESKTOP_DEV: "0",
    BOB_BLDER_DIR: path.join(resources, "blder"),
    BOB_VINEXT_CLI: path.join(resources, "blder/node_modules/vinext/dist/cli.js"),
    BOB_DB_MIGRATIONS_DIR: path.join(resources, "db-migrations"),
  };
}
