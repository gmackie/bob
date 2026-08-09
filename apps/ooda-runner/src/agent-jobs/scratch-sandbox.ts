import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const SAFE_JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export type ScratchSandbox = {
  path: string;
  cleanup(): Promise<void>;
};

export class ScratchSandboxManager {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    if (this.root === "/" || basename(this.root).length < 3) {
      throw new Error("Scratch root is too broad");
    }
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.root);
    if (stat.isSymbolicLink())
      throw new Error("Scratch root may not be a symlink");
    await chmod(this.root, 0o700);
  }

  async create(jobId: string): Promise<ScratchSandbox> {
    if (!SAFE_JOB_ID.test(jobId))
      throw new Error("Invalid job id for scratch sandbox");
    await this.ensureRoot();
    const path = await mkdtemp(join(this.root, `${jobId}-`));
    await chmod(path, 0o700);
    await Promise.all([
      mkdir(join(path, ".home"), { mode: 0o700 }),
      mkdir(join(path, ".tmp"), { mode: 0o700 }),
    ]);
    return {
      path,
      cleanup: () => rm(path, { recursive: true, force: true }),
    };
  }

  async cleanupRoot(): Promise<void> {
    try {
      const stat = await lstat(this.root);
      if (stat.isSymbolicLink()) {
        await unlink(this.root);
        return;
      }
      await rm(this.root, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async cleanupExpired(
    now = new Date(),
    maxAgeMs = 7 * 24 * 60 * 60 * 1_000,
  ): Promise<number> {
    await this.ensureRoot();
    const cutoff = now.getTime() - maxAgeMs;
    let removed = 0;
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(this.root, entry.name);
      const stat = await lstat(path);
      if (stat.mtimeMs > cutoff) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }
}

const PROVIDER_CREDENTIAL: Record<string, string | undefined> = {
  codex: "OPENAI_API_KEY",
  openai: "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  grok: "XAI_API_KEY",
};

export function buildIsolatedAgentEnvironment(input: {
  provider: string;
  sandboxPath: string;
  source?: Record<string, string | undefined>;
}): Record<string, string | undefined> {
  const source = input.source ?? process.env;
  const environment: Record<string, string | undefined> = {
    PATH: source.PATH,
    LANG: source.LANG,
    LC_ALL: source.LC_ALL,
    TERM: source.TERM,
    HOME: join(input.sandboxPath, ".home"),
    TMPDIR: join(input.sandboxPath, ".tmp"),
  };
  const credential = PROVIDER_CREDENTIAL[input.provider];
  if (credential && source[credential])
    environment[credential] = source[credential];
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
