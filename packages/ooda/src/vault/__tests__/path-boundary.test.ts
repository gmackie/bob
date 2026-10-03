import {
  mkdtemp,
  mkdir,
  readFile as fsRead,
  writeFile as fsWrite,
  symlink,
  rm,
  readdir,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { writeFile, writeFileOnce, deleteFile } from "../writer";
import { readFile, listFiles } from "../reader";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vault-path-"));
  roots.push(root);
  const vault = join(root, "vault"),
    outside = join(root, "outside");
  await mkdir(vault);
  await mkdir(outside);
  return { root, vault, outside };
}
it("allows internal directory aliases while preserving file-link replacement and delete semantics", async () => {
  const { vault } = await fixture();
  await mkdir(join(vault, "notes"));
  await symlink("notes", join(vault, "alias"));
  await writeFile(vault, "alias/nested/note.md", "hello");
  expect((await readFile(vault, "alias/nested/note.md")).content).toBe("hello");
  await symlink("notes/nested/note.md", join(vault, "file.md"));
  await writeFile(vault, "file.md", "replacement");
  expect((await lstat(join(vault, "file.md"))).isSymbolicLink()).toBe(false);
  expect(await fsRead(join(vault, "notes/nested/note.md"), "utf8")).toBe(
    "hello",
  );
  await symlink("notes/nested/note.md", join(vault, "delete.md"));
  await deleteFile(vault, "delete.md");
  expect(await fsRead(join(vault, "notes/nested/note.md"), "utf8")).toBe(
    "hello",
  );
});
it("rejects external and dangling aliases in all mutation helpers", async () => {
  const { vault, outside } = await fixture();
  await fsWrite(join(outside, "note.md"), "original");
  await symlink(outside, join(vault, "external"));
  await symlink(join(outside, "absent"), join(vault, "dangling"));
  for (const path of ["external/note.md", "dangling/note.md", ".GiT/config"]) {
    await expect(writeFile(vault, path, "changed")).rejects.toThrow();
    await expect(writeFileOnce(vault, path, "changed")).rejects.toThrow();
    await expect(deleteFile(vault, path)).rejects.toThrow();
  }
  expect(await fsRead(join(outside, "note.md"), "utf8")).toBe("original");
  expect(await readdir(outside)).toEqual(["note.md"]);
});
it("does not follow a preexisting predictable temporary-file symlink", async () => {
  const { vault, outside } = await fixture();
  await fsWrite(join(outside, "note.md"), "original");
  await symlink(join(outside, "note.md"), join(vault, "note.md.tmp"));
  await writeFile(vault, "note.md", "new content");
  expect(await fsRead(join(outside, "note.md"), "utf8")).toBe("original");
  expect(await fsRead(join(vault, "note.md"), "utf8")).toBe("new content");
  expect((await readdir(vault)).sort()).toEqual(["note.md", "note.md.tmp"]);
});
it("excludes Git metadata and external symlink trees from listings", async () => {
  const { vault, outside } = await fixture();
  await mkdir(join(vault, ".git"));
  await fsWrite(join(vault, ".git/private.md"), "private");
  await fsWrite(join(outside, "external.md"), "private");
  await fsWrite(join(vault, "visible.md"), "visible");
  await symlink(outside, join(vault, "external"));
  expect(await listFiles(vault)).toEqual(["visible.md"]);
});
