import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("workspace dependencies permit topological builds without package cycles", () => {
  const packages = new Map();
  for (const directory of ["apps", "packages", "packages/bob/src", "tooling"]) {
    for (const entry of readdirSync(resolve(root, directory), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(
          readFileSync(
            resolve(root, directory, entry.name, "package.json"),
            "utf8",
          ),
        );
        packages.set(manifest.name, manifest);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  const visited = new Set();
  const visit = (name, path = []) => {
    assert.ok(
      !path.includes(name),
      `Workspace dependency cycle: ${[...path, name].join(" -> ")}`,
    );
    if (visited.has(name)) return;
    const manifest = packages.get(name);
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    })) {
      if (packages.has(dependency)) visit(dependency, [...path, name]);
    }
    visited.add(name);
  };
  for (const name of packages.keys()) visit(name);
  const turbo = JSON.parse(readFileSync(resolve(root, "turbo.json"), "utf8"));
  assert.ok(turbo.tasks.build.dependsOn.includes("^build"));
});
