import { access } from "node:fs/promises";
import { join } from "node:path";
import { stat } from "node:fs/promises";

import { listFiles, readFile } from "./reader";
import { writeFile } from "./writer";
import { commitAndPush, pull, isLocked } from "./git";
import type { VaultConfig, VaultFile } from "./types";

export class VaultService {
  constructor(private config: VaultConfig) {}

  /** List .md files in the vault, optionally filtered by glob. */
  async list(glob?: string): Promise<string[]> {
    return listFiles(this.config.path, glob);
  }

  /** Read a file from the vault, parsing frontmatter. */
  async read(filePath: string): Promise<VaultFile> {
    return readFile(this.config.path, filePath);
  }

  /** Write a file to the vault and commit the change. */
  async write(
    filePath: string,
    content: string,
    frontmatter?: Record<string, unknown>,
  ): Promise<void> {
    await writeFile(this.config.path, filePath, content, frontmatter);
    await commitAndPush(this.config.path, `vault: update ${filePath}`);
  }

  /**
   * Promote a note from a thread into the vault.
   * Writes to `notes/{threadId}/{noteId}.md`, commits, and returns the path.
   */
  async promote(
    threadId: string,
    noteId: string,
    content: string,
    frontmatter?: Record<string, unknown>,
  ): Promise<string> {
    const filePath = `notes/${threadId}/${noteId}.md`;
    await writeFile(this.config.path, filePath, content, frontmatter);
    await commitAndPush(
      this.config.path,
      `promote: ${noteId} from thread ${threadId}`,
    );
    return filePath;
  }

  /** Pull latest changes from origin. */
  async sync(): Promise<{ filesChanged: number; conflicts: boolean }> {
    return pull(this.config.path);
  }

  /**
   * Health check: path exists, is a directory, has `.git/` subdir, is not locked.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const info = await stat(this.config.path);
      if (!info.isDirectory()) return false;

      await access(join(this.config.path, ".git"));

      if (await isLocked(this.config.path)) return false;

      return true;
    } catch {
      return false;
    }
  }
}
