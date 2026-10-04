/** Production ForgeVaultClient for the Node vault host (`clientModule` in the
 * OODA_FORGE_VAULT_CONFIG file). Trusted operator module: its settings come from
 * `client.json` beside the deployed bundle, never from requests or environment.
 * Bundle with `scripts/build-forge-vault-client.mjs`; deploy the single file. */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ArtifactPublisher } from "@forgegraph/runtime/artifact-publication";
import { gitArtifactPublicationProvider } from "@forgegraph/runtime/artifact-publication-git";
import { SqlArtifactPublicationJournal } from "@forgegraph/runtime/artifact-publication-sql";

const run = promisify(execFile);
const API = "https://api.cloudflare.com/client/v4/accounts/";
const TOKEN_TTL_SECONDS = 900;
const TOKEN_REFRESH_MARGIN_MS = 120_000;
const settingKeys = ["version", "account", "namespace", "repo", "remote", "credentialPath",
  "preparedPath", "journalDatabase", "authorName", "authorEmail"];

export async function loadClientSettings(path) {
  const settings = JSON.parse(await readFile(path, "utf8"));
  const keys = Object.keys(settings).sort();
  if (settings.version !== 1 || keys.join() !== [...settingKeys].sort().join()) {
    throw new Error("Vault client settings are invalid");
  }
  for (const key of ["credentialPath", "preparedPath", "journalDatabase"]) {
    if (!isAbsolute(settings[key])) throw new Error("Vault client paths must be absolute");
  }
  const remote = new URL(settings.remote);
  if (remote.protocol !== "https:" || !remote.hostname.endsWith(".artifacts.cloudflare.net") ||
      remote.username || remote.password || remote.search || remote.hash) {
    throw new Error("Vault client remote is invalid");
  }
  return Object.freeze(settings);
}

/** Git with no inherited GIT_* state, global config or hooks. */
function gitEnvironment(settings, token) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: settings.authorName, GIT_AUTHOR_EMAIL: settings.authorEmail,
    GIT_COMMITTER_NAME: settings.authorName, GIT_COMMITTER_EMAIL: settings.authorEmail,
  });
  if (token) {
    Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: "Authorization: Bearer " + token });
  }
  return env;
}

export function createTokenSource(settings, fetchImpl = fetch, now = Date.now) {
  let cached;
  async function api(path, body) {
    const credential = (await readFile(settings.credentialPath, "utf8")).trim();
    const response = await fetchImpl(API + settings.account + "/artifacts/namespaces/" + settings.namespace + path, {
      method: body ? "POST" : "GET",
      headers: { authorization: "Bearer " + credential, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    // Never include response bodies: they may echo token material.
    if (!response.ok) throw new Error("Cloudflare Artifacts HTTP " + response.status);
    const data = await response.json();
    if (!data.success) throw new Error("Cloudflare Artifacts request rejected");
    return data.result;
  }
  return {
    repository: () => api("/repos/" + settings.repo),
    async token() {
      if (cached && cached.expires - now() > TOKEN_REFRESH_MARGIN_MS) return cached.value;
      const issued = now();
      const result = await api("/tokens", { repo: settings.repo, scope: "write", ttl: TOKEN_TTL_SECONDS });
      if (typeof result?.plaintext !== "string" || !result.plaintext) throw new Error("Artifacts token missing");
      cached = { value: result.plaintext, expires: issued + TOKEN_TTL_SECONDS * 1000 };
      return cached.value;
    },
  };
}

export function sqliteExecutor(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  return {
    facade: "node-sqlite",
    first: async (s) => db.prepare(s.sql).get(...s.params) ?? null,
    all: async (s) => db.prepare(s.sql).all(...s.params),
    run: async (s) => ({ changes: Number(db.prepare(s.sql).run(...s.params).changes) }),
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((s) => ({ changes: Number(db.prepare(s.sql).run(...s.params).changes) }));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export async function createVaultClient(config, options = {}) {
  const settingsPath = options.settingsPath ?? join(dirname(fileURLToPath(import.meta.url)), "client.json");
  const settings = await loadClientSettings(settingsPath);
  const tokens = options.tokens ?? createTokenSource(settings);
  const git = async (cwd, args, token) =>
    (await run("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", ...args],
      { env: gitEnvironment(settings, token), timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

  // Fail closed unless the configured identity is this exact Cloudflare repository.
  const repository = await tokens.repository();
  if (repository?.id !== config.repositoryId) throw new Error("Vault repository identity mismatch");

  const head = async (ref) => {
    const out = await git(settings.preparedPath, ["ls-remote", "--", settings.remote, ref], await tokens.token());
    return out ? out.split(/\s+/)[0] : null;
  };
  const provider = gitArtifactPublicationProvider({
    directory: settings.preparedPath,
    remote: settings.remote,
    token: () => tokens.token(),
    identity: {
      open: async () => ({
        repositoryId: config.repositoryId, objectFormat: "sha1",
        resolve: head, commit: async () => null, file: async () => null, dispose() {},
      }),
    },
  });
  const journal = new SqlArtifactPublicationJournal(options.sql ?? sqliteExecutor(settings.journalDatabase));
  await journal.initialize();
  const binding = { tenant: config.tenant, artifact: config.artifact, generation: config.generation,
    repositoryId: config.repositoryId, provider };
  const publisher = new ArtifactPublisher([binding], journal, async (request) =>
    request.tenant === config.tenant && request.artifact === config.artifact &&
    request.generation === config.generation && request.actor === config.actor);
  const context = () => ({ tenant: config.tenant, actor: config.actor, requestId: randomUUID() });

  const resolve = async (selector) => {
    const target = "ref" in selector ? selector.ref : selector.revision;
    const objectId = await git(config.vaultPath, ["rev-parse", "--verify", "--end-of-options", target + "^{commit}"]);
    const treeId = await git(config.vaultPath, ["rev-parse", "--verify", objectId + "^{tree}"]);
    return { objectId, treeId, objectFormat: "sha1" };
  };
  return {
    currentRef: () => git(config.vaultPath, ["symbolic-ref", "-q", "HEAD"]),
    resolve,
    async commitWorkingTree(message) {
      await git(config.vaultPath, ["add", "-A"]);
      if (!(await git(config.vaultPath, ["status", "--porcelain"]))) return null;
      await git(config.vaultPath, ["commit", "--no-verify", "-m", message]);
      const revision = await resolve({ ref: "HEAD" });
      // Publication pushes from the prepared repository, never the working vault.
      await git(settings.preparedPath, ["fetch", "--no-tags", "--", config.vaultPath, revision.objectId]);
      return revision;
    },
    async remoteHead(ref) {
      try {
        return { reachable: true, head: await head(ref) };
      } catch (error) {
        return { reachable: false, error: error instanceof Error ? error.message : "Remote head unavailable" };
      }
    },
    publish: (input) => publisher.publish(input, context()),
    recover: (input) => publisher.recover(input, context()),
  };
}
