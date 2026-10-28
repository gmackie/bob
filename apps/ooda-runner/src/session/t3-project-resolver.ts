/**
 * Resolve which t3code project/worktree an OODA session should run in.
 *
 * A single runner serves many LevelForge games. LevelForge local Unity agents
 * register their project in a JSON registry keyed by the OODA thread slug
 * (`lf-<gameProjectId>`, the slug studioAgent.dispatch creates):
 *
 *   { "projects": { "lf-<uuid>": { "worktreePath": "/abs/path", "title": "Test Game" } } }
 *
 * Given a thread slug, the resolver looks up the worktree, then finds the
 * matching t3code project by workspaceRoot in the orchestration snapshot, or
 * creates one with `t3 project add`. Results are cached per worktree.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface T3ProjectRegistryEntry {
  worktreePath: string;
  title?: string;
  t3codeProjectId?: string;
}

export interface T3ProjectTarget {
  projectId: string;
  worktreePath: string;
}

export interface T3ProjectResolverOptions {
  registryFile: string;
  serverUrl: string;
  authToken?: string;
  /** `--base-dir` for `t3 project add`; when absent, projects are never created. */
  t3BaseDir?: string;
  t3Bin?: string;
  fetchImpl?: typeof fetch;
  exec?: (file: string, args: string[]) => Promise<{ stdout: string }>;
  readRegistry?: (file: string) => Promise<string>;
}

export async function readT3ProjectRegistry(
  file: string,
  read: (file: string) => Promise<string> = (f) => readFile(f, "utf8"),
): Promise<Record<string, T3ProjectRegistryEntry>> {
  let raw: string;
  try {
    raw = await read(file);
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as { projects?: Record<string, T3ProjectRegistryEntry> };
    const projects = parsed?.projects;
    if (!projects || typeof projects !== "object") return {};
    const out: Record<string, T3ProjectRegistryEntry> = {};
    for (const [key, value] of Object.entries(projects)) {
      if (value && typeof value.worktreePath === "string" && value.worktreePath) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function createT3ProjectResolver(opts: T3ProjectResolverOptions) {
  const cache = new Map<string, string>(); // worktreePath -> t3code project id
  const fetchFn = opts.fetchImpl ?? fetch;
  const exec =
    opts.exec ??
    (async (file: string, args: string[]) => {
      const { stdout } = await execFileAsync(file, args, { timeout: 60_000 });
      return { stdout };
    });

  async function findInSnapshot(worktreePath: string): Promise<string | null> {
    const url = new URL(opts.serverUrl);
    url.pathname = "/api/orchestration/snapshot";
    url.search = "";
    url.hash = "";
    const headers: Record<string, string> = {};
    if (opts.authToken) headers.Authorization = `Bearer ${opts.authToken}`;
    const response = await fetchFn(url.toString(), { headers });
    if (!response.ok) throw new Error(`t3code snapshot failed: ${response.status}`);
    const snapshot = (await response.json()) as {
      projects?: Array<{ id: string; workspaceRoot?: string; deletedAt?: string | null }>;
    };
    const match = snapshot.projects?.find(
      (p) => !p.deletedAt && p.workspaceRoot === worktreePath,
    );
    return match?.id ?? null;
  }

  async function createProject(entry: T3ProjectRegistryEntry): Promise<string> {
    if (!opts.t3BaseDir) {
      throw new Error(
        `no t3code project for ${entry.worktreePath} and OODA_T3CODE_BASE_DIR is unset`,
      );
    }
    const args = ["project", "add", "--base-dir", opts.t3BaseDir];
    if (entry.title) args.push("--title", entry.title);
    args.push(entry.worktreePath);
    const { stdout } = await exec(opts.t3Bin ?? "t3", args);
    const m = /Added project ([0-9a-fA-F-]{36})/.exec(stdout);
    if (!m) throw new Error(`could not parse t3 project add output: ${stdout.slice(0, 200)}`);
    return m[1]!;
  }

  return {
    async resolve(threadSlug: string): Promise<T3ProjectTarget | null> {
      const registry = await readT3ProjectRegistry(opts.registryFile, opts.readRegistry);
      const entry = registry[threadSlug];
      if (!entry) return null;
      const worktreePath = entry.worktreePath;
      let projectId = entry.t3codeProjectId ?? cache.get(worktreePath) ?? null;
      if (!projectId) projectId = await findInSnapshot(worktreePath);
      if (!projectId) projectId = await createProject(entry);
      cache.set(worktreePath, projectId);
      return { projectId, worktreePath };
    },
  };
}
