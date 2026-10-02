/** Local staging composition: actual Bob vault -> actual Forge publisher -> Git. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {randomBytes} from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
if(process.env.FORGE_PILOT_BUNDLED !== "true"){const {register}=await import("tsx/esm/api");register();}
const {startVaultPilotHost}=await import("./forge-vault-http-host.ts");
const { ForgePublicationStorage } = await import(
  "../src/vault/forge-publication-storage.ts"
);
const { PublicationJournal } = await import(
  "../src/vault/publication-journal.ts"
);
const { LocalGitStorage } = await import("../src/vault/local-git-storage.ts");
const { VaultService } = await import("../src/vault/vault-service.ts");
const live =
  process.env.FORGE_VAULT_LIVE_CONFIG === "stdin"
    ? JSON.parse(readFileSync(0, "utf8"))
    : null;
async function api(path, body) {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" + live.account + path,
    {
      method: body ? "POST" : "GET",
      headers: {
        authorization: "Bearer " + live.credential,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!response.ok) throw Error("Cloudflare HTTP " + response.status);
  const data = await response.json();
  if (!data.success) throw Error("Cloudflare request rejected");
  return data.result;
}
const root = process.env.FORGE_RUNTIME_ROOT;
if (!root)
  throw Error(
    "FORGE_RUNTIME_ROOT must identify the built Forge runtime workspace",
  );
const load = (path) =>
  import(pathToFileURL(resolve(root, "packages/runtime/dist", path)));
const { ArtifactPublisher } = await load("artifact-publication.js");
const { SqlArtifactPublicationJournal } = await load(
  "adapters/artifact-publication-sql.js",
);
const { gitArtifactPublicationProvider } = await load(
  "adapters/artifact-publication-git.js",
);
const directory = await mkdtemp(join(tmpdir(), "bob-forge-pilot-"));
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Pilot",
  GIT_AUTHOR_EMAIL: "pilot@example.invalid",
  GIT_COMMITTER_NAME: "Pilot",
  GIT_COMMITTER_EMAIL: "pilot@example.invalid",
};
const git = (cwd, args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
let db, httpHost;
try {
  git(directory, ["init", "--bare", "remote.git"]);
  git(directory, ["init", "--bare", "prepared.git"]);
  git(directory, ["init", "-b", "main", "vault"]);
  const vault = join(directory, "vault"),
    remote = join(directory, "remote.git"),
    prepared = join(directory, "prepared.git");
  const head = (ref) => {
    try {
      if (live) {
        const out = execFileSync("git", ["ls-remote", live.remote, ref], {
          encoding: "utf8",
          env: {
            ...env,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.extraHeader",
            GIT_CONFIG_VALUE_0: "Authorization: Bearer " + live.token,
          },
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 45000,
        }).trim();
        return out ? out.split(/\s+/)[0] : null;
      }
      return git(remote, ["rev-parse", "--verify", ref]);
    } catch {
      if (!live) return null;
      throw Error("Remote head unavailable");
    }
  };
  const repositoryId = live?.repoId ?? "pilot-repo";
  const provider = gitArtifactPublicationProvider({
    directory: prepared,
    remote: live?.remote ?? remote,
    ...(live ? { token: async () => live.token } : {}),
    identity: {
      open: async () => ({
        repositoryId: live
          ? (
              await api(
                "/artifacts/namespaces/forge-runtime-cert/repos/" + live.repo,
              )
            ).id
          : repositoryId,
        objectFormat: "sha1",
        resolve: async (ref) => head(ref),
        commit: async () => null,
        file: async () => null,
        dispose() {},
      }),
    },
  });
  db = new DatabaseSync(join(directory, "forge.sqlite"));
  const sql = {
    facade: "pilot-sqlite",
    first: async (s) => db.prepare(s.sql).get(...s.params) ?? null,
    all: async (s) => db.prepare(s.sql).all(...s.params),
    run: async (s) => ({
      changes: Number(db.prepare(s.sql).run(...s.params).changes),
    }),
    batch: async () => {
      throw Error("unused");
    },
  };
  const query = async (statement) => {
    const results = await api(
      "/d1/database/" + live.database + "/query",
      statement,
    );
    if (results.length !== 1 || !results[0].success)
      throw Error("D1 request failed");
    return results[0];
  };
  const remoteSql = {
    facade: "live-d1-rest",
    first: async (s) => (await query(s)).results[0] ?? null,
    all: async (s) => (await query(s)).results,
    run: async (s) => ({ changes: (await query(s)).meta.changes }),
    batch: async () => {
      throw Error("unused");
    },
  };
  const journal = new SqlArtifactPublicationJournal(live ? remoteSql : sql);
  await journal.initialize();
  let allowed = true,
    writes = 0,
    loseAck = false;
  const wrapped = {
    open: async () => {
      const repo = await provider.open();
      return {
        ...repo,
        compareAndSwap: async (...args) => {
          writes++;
          const result = await repo.compareAndSwap(...args);
          if (loseAck && result === "accepted")
            throw Error("Injected lost response");
          return result;
        },
      };
    },
  };
  const ctx = { tenant: "pilot", actor: "pilot-user", requestId: "pilot" };
  const publisher = () =>
    new ArtifactPublisher(
      [
        {
          tenant: "pilot",
          artifact: "vault",
          generation: "one",
          repositoryId,
          provider: wrapped,
        },
      ],
      journal,
      async () => allowed,
    );
  const local = new LocalGitStorage(vault);
  const client = {
    currentRef: () => local.currentRef(),
    resolve: (selector) => local.resolve(selector),
    commitWorkingTree: async (message) => {
      const revision = await local.commitWorkingTree(message);
      if (revision) git(prepared, ["fetch", "--", vault, revision.objectId]);
      return revision;
    },
    remoteHead: async (ref) => ({ reachable: true, head: head(ref) }),
    publish: (input) => publisher().publish(input, ctx),
    recover: (input) => publisher().recover(input, ctx),
  };
  const storage = () =>
    new ForgePublicationStorage(
      {
        tenant: ctx.tenant,
        actor: ctx.actor,
        artifact: "vault",
        generation: "one",
        repositoryId,
      },
      new PublicationJournal(join(directory, "bob-receipts")),
      client,
    );
  const service = () =>
    new VaultService(
      { path: vault, name: "pilot", kind: "personal" },
      storage(),
    );
  const verifyContent = (oid, path) => {
    if (live) {
      execFileSync("git", ["-C", remote, "fetch", "--", live.remote, oid], {
        env: {
          ...env,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.extraHeader",
          GIT_CONFIG_VALUE_0: "Authorization: Bearer " + live.token,
        },
        stdio: "pipe",
        timeout: 45000,
      });
    }
    return git(remote, ["show", oid + ":" + path]);
  };
  if(process.env.FORGE_VAULT_HTTP === "true") httpHost=await startVaultPilotHost(service,randomBytes(32).toString('hex'));
  const write=(path,content)=>httpHost?httpHost.call({action:'write',path,content}):service().write(path,content);
  const replay=()=>httpHost?httpHost.call({action:'replay'}):service().replayPending();
  const first = await write("notes/pilot.md", "first body");
  assert.equal(first.state, "published");
  assert.equal(
    verifyContent(first.intent.revision.objectId, "notes/pilot.md"),
    "first body",
  );
  const before = writes;
  assert.deepEqual(await replay(), []);
  assert.equal(writes, before);
  loseAck = true;
  const uncertain = await write("notes/pilot.md", "second body");
  assert.equal(uncertain.state, "indeterminate");
  const after = writes;
  const recovered = await replay();
  assert.equal(recovered[0].state, "indeterminate");
  assert.equal(writes, after);
  assert.equal(
    verifyContent(head("refs/heads/main"), "notes/pilot.md"),
    "second body",
  );
  allowed = false;
  await assert.rejects(
    storage().publish({
      operationId: first.intent.operationId,
      ref: first.intent.ref,
      expectedHead: first.intent.expectedHead,
      revision: first.intent.revision,
    }),
    { code: "NotAuthorized" },
  );
  const evidence = {
    at: new Date().toISOString(),
    scope: live
      ? "Live Cloudflare Artifacts and D1 composed with actual Bob VaultService, ForgePublicationStorage, Forge ArtifactPublisher and Git transport; no production rollout"
      : "Local staging: actual Bob VaultService and ForgePublicationStorage composed with Forge ArtifactPublisher, SqlArtifactPublicationJournal and real Git transport; SQLite metadata, no cloud or production deployment",
    status: "passed",
    checks: [
      "exact vault content published",
      "reconstructed service does not resend terminal work",
      "lost acknowledgement stays indeterminate despite desired-head observation",
      "recovery never repeats Git publication",
      "revoked authorization rejects receipt replay",
    ],
    transport: httpHost ? "isolated loopback HTTP fixture" : "direct service composition",
    gitDispatches: writes,
    cleanup: "temporary fixture removed by finally",
  };
  if (process.env.FORGE_VAULT_EVIDENCE)
    await writeFile(
      process.env.FORGE_VAULT_EVIDENCE,
      JSON.stringify(evidence, null, 2) + "\n",
    );
  console.log(
    JSON.stringify({
      ...evidence,
      tests: evidence.checks.map((name) => ({ name, status: "passed" })),
    }),
  );
} finally {
  await httpHost?.close();
  db?.close();
  await rm(directory, { recursive: true, force: true });
}
