import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";

const inside = (root, value) => {
  const relative = path.relative(root, value);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};
const digest = (value) => createHash("sha256").update(value).digest("hex");

/** Verify registry provenance and remove checkout-dependent legacy workspace hoists. */
export function finalizePortableDeploy(repoRoot, targetDir) {
  const target = fs.realpathSync(targetDir);
  const modules = path.join(target, "node_modules");
  const store = path.join(modules, ".pnpm");
  const sourceText = fs.readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
  const installedText = fs.readFileSync(path.join(store, "lock.yaml"), "utf8");
  const source = parse(sourceText);
  const installed = parse(installedText);
  let registryPackages = 0;
  for (const [key, metadata] of Object.entries(installed.packages ?? {})) {
    if (key.includes("@file:")) continue;
    if (!source.packages?.[key] || !isDeepStrictEqual(metadata.resolution, source.packages[key].resolution)) {
      throw new Error(`Deployed dependency differs from the workspace lock: ${key}`);
    }
    registryPackages++;
  }
  if (!isDeepStrictEqual(source.overrides, installed.overrides)) {
    throw new Error("Deployed dependency overrides differ from the workspace lock");
  }
  for (const [key, patch] of Object.entries(installed.patchedDependencies ?? {})) {
    if (!installed.packages?.[key]) continue;
    if (!isDeepStrictEqual(source.patchedDependencies?.[key], patch)) {
      throw new Error(`Deployed security patch differs from the workspace lock: ${key}`);
    }
    const bytes = fs.readFileSync(path.resolve(repoRoot, patch.path));
    if (digest(bytes) !== patch.hash) throw new Error(`Security patch hash mismatch: ${key}`);
  }

  // Legacy deploy copies every workspace public hoist, even packages outside the
  // deployed closure. Registry dependencies and real file: workspace copies are
  // already local; only these unused workspace aliases can refer to the checkout.
  const hoists = path.join(store, "node_modules");
  const copied = new Map();
  for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.includes("@file+")) continue;
    const nested = path.join(store, entry.name, "node_modules");
    if (!fs.existsSync(nested)) continue;
    const entries = fs.readdirSync(nested).flatMap((name) => name.startsWith("@")
      ? fs.readdirSync(path.join(nested, name)).map((child) => `${name}/${child}`)
      : [name]);
    for (const name of entries) {
      const candidate = path.join(nested, name);
      if (!fs.lstatSync(candidate).isDirectory() || !fs.existsSync(path.join(candidate, "package.json"))) continue;
      const actual = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8")).name;
      if (actual === name) copied.set(name, [...(copied.get(name) ?? []), candidate]);
    }
  }
  const normalizedHoists = [];
  const removedHoists = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        let resolved;
        try { resolved = fs.realpathSync(file); } catch { throw new Error(`Broken deployed symlink: ${file}`); }
        if (inside(target, resolved)) continue;
        const name = path.relative(hoists, file).split(path.sep).join("/");
        const isWorkspaceHoist = /^@(bob|gmacko)\/[^/]+$/.test(name);
        if (!isWorkspaceHoist) throw new Error(`Deployed symlink escapes the package: ${file}`);
        const manifest = path.join(resolved, "package.json");
        if (!inside(fs.realpathSync(repoRoot), resolved) || !fs.existsSync(manifest)
          || JSON.parse(fs.readFileSync(manifest, "utf8")).name !== name) {
          throw new Error(`Unexpected external workspace hoist: ${file}`);
        }
        const candidates = copied.get(name) ?? [];
        if (candidates.length > 1) throw new Error(`Ambiguous deployed workspace hoist: ${name}`);
        fs.unlinkSync(file);
        if (candidates.length === 1) {
          fs.symlinkSync(path.relative(path.dirname(file), candidates[0]), file);
          normalizedHoists.push(name);
        } else removedHoists.push(name);
      } else if (entry.isDirectory()) visit(file);
    }
  }
  visit(modules);
  const receipt = { sourceLockSha256: digest(sourceText), installedLockSha256: digest(installedText), registryPackages, normalizedHoists, removedHoists };
  fs.writeFileSync(path.join(target, "dependency-provenance.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}
