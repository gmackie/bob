import { access } from "node:fs/promises";
import { join } from "node:path";
import { stat } from "node:fs/promises";

import { listFiles, readFile } from "./reader";
import { writeFile } from "./writer";
import { commitAndPush, pull, isLocked } from "./git";
import { LocalGitStorage } from "./local-git-storage";
import type { VaultConfig, VaultFile } from "./types";
import type { PublicationRecord } from "./versioned-storage";

export interface PromoteResult {
  filePath: string;
  publication: PublicationRecord;
}

export class VaultService {
  constructor(private config: VaultConfig, private publication?: import("./git").CommitAndPushOptions["storage"]) {}

  /** List .md files in the vault, optionally filtered by glob. */
  async list(glob?: string): Promise<string[]> {
    return listFiles(this.config.path, glob);
  }

  /** Read a file from the vault, parsing frontmatter. */
  async read(filePath: string): Promise<VaultFile> {
    return readFile(this.config.path, filePath);
  }

  /**
   * Write a file to the vault, commit, and publish. The returned record says
   * whether the change is durably published or only saved locally.
   */
  async write(
    filePath: string,
    content: string,
    frontmatter?: Record<string, unknown>,
  ): Promise<PublicationRecord> {
    await writeFile(this.config.path, filePath, content, frontmatter);
    return commitAndPush(this.config.path, `vault: update ${filePath}`, this.publication ? {storage:this.publication} : {});
  }

  /**
   * Promote a note from a thread into the vault.
   * Writes to `notes/{threadId}/{noteId}.md`, commits, publishes, and
   * returns the path together with the publication record.
   */
  async promote(
    threadId: string,
    noteId: string,
    content: string,
    frontmatter?: Record<string, unknown>,
  ): Promise<PromoteResult> {
    const filePath = `notes/${threadId}/${noteId}.md`;
    await writeFile(this.config.path, filePath, content, frontmatter);
    const publication = await commitAndPush(
      this.config.path,
      `promote: ${noteId} from thread ${threadId}`,
      this.publication ? {storage:this.publication} : {},
    );
    return { filePath, publication };
  }

  /** Re-attempt publications that never reached the remote. */
  async replayPending(): Promise<PublicationRecord[]> {
    return (this.publication ?? new LocalGitStorage(this.config.path)).replayPending();
  }

  /** Publications that are not yet durably published. */
  async listUnpublished(): Promise<PublicationRecord[]> {
    return (this.publication ?? new LocalGitStorage(this.config.path)).listUnpublished();
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
