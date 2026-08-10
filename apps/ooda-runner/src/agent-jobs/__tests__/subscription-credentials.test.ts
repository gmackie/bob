import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSubscriptionCredentialHome,
  materializeCredentialCopies,
} from "../subscription-credentials";

describe("materializeCredentialCopies", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("copies only the declared subscription credential into the disposable home", async () => {
    const root = await mkdtemp(join(tmpdir(), "ooda-subscription-copy-"));
    roots.push(root);
    const trustedHome = join(root, "trusted");
    const sandbox = join(root, "sandbox");
    const source = join(trustedHome, ".codex", "auth.json");
    const destination = join(sandbox, ".home", ".codex", "auth.json");
    await mkdir(join(trustedHome, ".codex"), { recursive: true });
    await mkdir(sandbox, { recursive: true });
    await writeFile(source, "subscription-token", { mode: 0o600 });
    await chmod(source, 0o600);

    await materializeCredentialCopies(sandbox, [
      { sourcePath: source, destinationPath: destination },
    ]);

    expect(await readFile(destination, "utf8")).toBe("subscription-token");
    expect((await lstat(destination)).mode & 0o777).toBe(0o600);
  });

  it("rejects symlinked credential sources and destinations outside the sandbox", async () => {
    const root = await mkdtemp(join(tmpdir(), "ooda-subscription-copy-"));
    roots.push(root);
    const sandbox = join(root, "sandbox");
    const credential = join(root, "credential.json");
    const linkedCredential = join(root, "linked-credential.json");
    await mkdir(sandbox, { recursive: true });
    await writeFile(credential, "secret", { mode: 0o600 });
    await symlink(credential, linkedCredential);

    await expect(
      materializeCredentialCopies(sandbox, [
        {
          sourcePath: linkedCredential,
          destinationPath: join(sandbox, ".home", "auth.json"),
        },
      ]),
    ).rejects.toThrow(/regular file/);
    await expect(
      materializeCredentialCopies(sandbox, [
        { sourcePath: credential, destinationPath: join(root, "escaped") },
      ]),
    ).rejects.toThrow(/escapes the scratch sandbox/);
  });

  it("destroys an independently owned credential home without following agent-controlled symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "ooda-subscription-home-"));
    roots.push(root);
    const external = join(root, "external");
    const credentialHome = await createSubscriptionCredentialHome(root);
    await mkdir(external, { recursive: true });
    await writeFile(join(external, "auth.json"), "operator-token", {
      mode: 0o600,
    });
    await mkdir(join(credentialHome.path, ".codex"));
    await rm(join(credentialHome.path, ".codex"), { recursive: true });
    await symlink(external, join(credentialHome.path, ".codex"));

    await credentialHome.cleanup();

    expect(await readFile(join(external, "auth.json"), "utf8")).toBe(
      "operator-token",
    );
    await expect(lstat(credentialHome.path)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
