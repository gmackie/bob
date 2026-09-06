import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { finalizePortableDeploy } from "./portable-deploy.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-portable-deploy-")); roots.push(root);
  const repo = path.join(root, "repo"); const target = path.join(root, "target");
  const store = path.join(target, "node_modules/.pnpm"); const hoists = path.join(store, "node_modules/@bob");
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(hoists, { recursive: true });
  const lock = { packages: { "example@1.0.0": { resolution: { integrity: "sha512-test" } } }, overrides: {} };
  fs.writeFileSync(path.join(repo, "pnpm-lock.yaml"), stringify(lock));
  fs.writeFileSync(path.join(store, "lock.yaml"), stringify(lock));
  return { repo, target, store, hoists, lock };
}
function packageDir(dir, name) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name })); }

it("normalizes copied workspace hoists and removes unrelated checkout aliases", () => {
  const f = fixture();
  const copied = path.join(f.store, "@bob+used@file+packages+used/node_modules/@bob/used");
  packageDir(copied, "@bob/used");
  for (const name of ["used", "unused"]) {
    const source = path.join(f.repo, name); packageDir(source, `@bob/${name}`);
    fs.symlinkSync(source, path.join(f.hoists, name));
  }
  const receipt = finalizePortableDeploy(f.repo, f.target);
  expect(fs.realpathSync(path.join(f.hoists, "used"))).toBe(fs.realpathSync(copied));
  expect(fs.existsSync(path.join(f.hoists, "unused"))).toBe(false);
  expect(receipt.normalizedHoists).toEqual(["@bob/used"]);
  expect(receipt.removedHoists).toEqual(["@bob/unused"]);
});

it("rejects changed registry integrity before modifying the stage", () => {
  const f = fixture(); f.lock.packages["example@1.0.0"].resolution.integrity = "sha512-wrong";
  fs.writeFileSync(path.join(f.store, "lock.yaml"), stringify(f.lock));
  expect(() => finalizePortableDeploy(f.repo, f.target)).toThrow(/differs from the workspace lock/);
});

it("rejects an arbitrary external symlink instead of silently deleting it", () => {
  const f = fixture(); fs.symlinkSync(f.repo, path.join(f.target, "node_modules/outside"));
  expect(() => finalizePortableDeploy(f.repo, f.target)).toThrow(/escapes the package/);
});
