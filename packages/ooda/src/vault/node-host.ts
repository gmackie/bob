/** Node-only deployment entrypoint. Configuration and client modules are trusted
 * operator files, never request input. Import this subpath, not the edge barrel. */
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ForgePublicationStorage, type ForgeVaultClient } from "./forge-publication-storage";
import { PublicationJournal } from "./publication-journal";
import { PersistentVaultGate } from "./persistent-vault-gate";
import { VaultRouteHost } from "./vault-route-host";
import { VaultService } from "./vault-service";

const identity = z.string().trim().min(1).regex(/^[^\x00-\x1f\x7f]+$/);
const absolute = z.string().refine(isAbsolute, "Absolute path required");
const configSchema = z.object({
  version: z.literal(1),
  tenant: identity, actor: identity, artifact: identity, generation: identity,
  repositoryId: identity, kind: z.enum(["personal", "research"]),
  vaultPath: absolute, gatePath: absolute, journalPath: absolute,
  clientModule: absolute,
}).strict();
export type NodeVaultConfig = z.infer<typeof configSchema>;
export interface ConfiguredNodeVault {
  readonly config: Readonly<NodeVaultConfig>;
  readonly routeHost: VaultRouteHost;
  readonly publication: ForgePublicationStorage;
  readonly admission: PersistentVaultGate;
  close(): Promise<void>;
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep));
}

export async function loadNodeVaultHost(configPath: string): Promise<ConfiguredNodeVault> {
  if (!isAbsolute(configPath)) throw new Error("Vault config must be an absolute path");
  const parsed = configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  const canonicalConfigPath = await realpath(configPath);
  const [vaultPath, gatePath, journalPath, clientModule] = await Promise.all(
    [realpath(parsed.vaultPath), realpath(parsed.gatePath), realpath(parsed.journalPath), realpath(parsed.clientModule)],
  );
  // Startup must not recreate lost control state or put it in published content.
  if (!(await stat(vaultPath)).isDirectory() || !(await stat(journalPath)).isDirectory() ||
      !(await stat(gatePath)).isFile() || !(await stat(clientModule)).isFile() ||
      inside(vaultPath, canonicalConfigPath) || inside(vaultPath, gatePath) ||
      inside(vaultPath, journalPath) || inside(vaultPath, clientModule) ||
      inside(journalPath, canonicalConfigPath) || inside(journalPath, clientModule) || inside(journalPath, gatePath)) {
    throw new Error("Vault workspace and external control paths are invalid");
  }
  const config = Object.freeze({ ...parsed, vaultPath, gatePath, journalPath, clientModule });
  const admission = new PersistentVaultGate(gatePath, config.generation, false);
  try {
  const module = await import(/* webpackIgnore: true */ pathToFileURL(clientModule).href) as {
    createVaultClient?: (config: Readonly<NodeVaultConfig>) => Promise<ForgeVaultClient>;
  };
  if (typeof module.createVaultClient !== "function") throw new Error("Vault client factory is missing");
  const client = await module.createVaultClient(config);
  for (const method of ["resolve", "commitWorkingTree", "remoteHead", "currentRef", "publish", "recover"] as const) {
    if (typeof client?.[method] !== "function") throw new Error("Vault client is incomplete");
  }
  const { tenant, actor, artifact, generation, repositoryId } = config;
  const publication = new ForgePublicationStorage({ tenant, actor, artifact, generation, repositoryId }, new PublicationJournal(journalPath), client);
  const service = new VaultService({ path: vaultPath, name: config.artifact, kind: config.kind }, publication);
  const routeHost = new VaultRouteHost([{ actor: config.actor, kind: config.kind, service }], admission);
  return Object.freeze({ config, publication, admission, routeHost,
    async close() { await routeHost.closeAndDrain(); admission.dispose(); },
  });
  } catch (error) {
    admission.dispose();
    throw error;
  }
}

/** Pin configuration (including failure) for this process; no request-time
 * fallback or generation switch. Restart explicitly after a drained cutover. */
export function createNodeVaultHostLoader(environment: Readonly<Record<string, string | undefined>>) {
  const path = environment.OODA_FORGE_VAULT_CONFIG;
  let loaded: Promise<ConfiguredNodeVault | undefined> | undefined;
  return () => loaded ??= path === undefined ? Promise.resolve(undefined) : loadNodeVaultHost(path);
}
const processState = globalThis as typeof globalThis & {
  __oodaNodeVaultLoader?: ReturnType<typeof createNodeVaultHostLoader>;
};
export function getConfiguredNodeVault(): Promise<ConfiguredNodeVault | undefined> {
  processState.__oodaNodeVaultLoader ??= createNodeVaultHostLoader(process.env);
  return processState.__oodaNodeVaultLoader();
}
