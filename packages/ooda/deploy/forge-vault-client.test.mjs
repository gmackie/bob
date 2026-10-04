// Run against the built bundle: FORGE_VAULT_CLIENT_BUNDLE=/abs/vault-client.mjs node --test deploy/
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const bundle = process.env.FORGE_VAULT_CLIENT_BUNDLE;
if (!bundle) throw new Error("FORGE_VAULT_CLIENT_BUNDLE must name the built client bundle");
const client = await import(bundle);
const dir = await mkdtemp(join(tmpdir(), "forge-vault-client-"));
const settings = {
  version: 1, account: "acct", namespace: "bob", repo: "vault",
  remote: "https://acct.artifacts.cloudflare.net/git/bob/vault.git",
  credentialPath: join(dir, "credential"), preparedPath: join(dir, "prepared.git"),
  journalDatabase: join(dir, "journal.sqlite"), authorName: "Vault", authorEmail: "vault@example.invalid",
};
const write = async (name, value) => { const path = join(dir, name); await writeFile(path, JSON.stringify(value)); return path; };

test("settings reject unknown keys, relative paths and non-Artifacts remotes", async () => {
  await assert.doesNotReject(client.loadClientSettings(await write("ok.json", settings)));
  await assert.rejects(client.loadClientSettings(await write("extra.json", { ...settings, extra: 1 })), /invalid/);
  await assert.rejects(client.loadClientSettings(await write("rel.json", { ...settings, preparedPath: "prepared.git" })), /absolute/);
  for (const remote of ["http://acct.artifacts.cloudflare.net/x.git", "https://example.com/x.git",
    "https://user:pw@acct.artifacts.cloudflare.net/x.git"]) {
    await assert.rejects(client.loadClientSettings(await write("remote.json", { ...settings, remote })), /remote/);
  }
});

test("token source reads the credential per mint, caches, and refreshes before expiry", async () => {
  await writeFile(settings.credentialPath, "secret-1\n");
  const calls = [];
  let now = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization, body: init.body && JSON.parse(init.body) });
    return new Response(JSON.stringify({ success: true, result: { plaintext: "token-" + calls.length } }));
  };
  const tokens = client.createTokenSource(settings, fetchImpl, () => now);
  assert.equal(await tokens.token(), "token-1");
  assert.equal(await tokens.token(), "token-1");
  assert.deepEqual(calls[0].body, { repo: "vault", scope: "write", ttl: 900 });
  assert.equal(calls[0].auth, "Bearer secret-1");
  await writeFile(settings.credentialPath, "secret-2\n");
  now = 900_000 - 119_000;
  assert.equal(await tokens.token(), "token-2");
  assert.equal(calls[1].auth, "Bearer secret-2");
});

test("token source never surfaces response bodies on failure", async () => {
  await writeFile(settings.credentialPath, "secret");
  const fetchImpl = async () => new Response("echo secret plaintext", { status: 403 });
  await assert.rejects(client.createTokenSource(settings, fetchImpl).token(),
    (error) => error.message === "Cloudflare Artifacts HTTP 403");
});

test("client fails closed when the Cloudflare repository identity differs", async () => {
  const tokens = { repository: async () => ({ id: "other" }), token: async () => "t" };
  await assert.rejects(client.createVaultClient({ repositoryId: "expected" },
    { settingsPath: await write("ok2.json", settings), tokens }), /identity mismatch/);
});

test("sqlite executor batch is atomic", async () => {
  const sql = client.sqliteExecutor(join(dir, "batch.sqlite"));
  await sql.run({ sql: "CREATE TABLE t (id INTEGER PRIMARY KEY)", params: [] });
  await assert.rejects(sql.batch([
    { sql: "INSERT INTO t (id) VALUES (?)", params: [1] },
    { sql: "INSERT INTO t (id) VALUES (?)", params: [1] },
  ]));
  assert.deepEqual(await sql.all({ sql: "SELECT id FROM t", params: [] }), []);
  await sql.batch([{ sql: "INSERT INTO t (id) VALUES (?)", params: [2] }]);
  assert.deepEqual((await sql.first({ sql: "SELECT id FROM t", params: [] })).id, 2);
});
