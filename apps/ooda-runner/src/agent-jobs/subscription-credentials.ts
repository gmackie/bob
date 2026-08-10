import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

export type SubscriptionCredentialHome = {
  path: string;
  cleanup(): Promise<void>;
};

export async function createSubscriptionCredentialHome(
  parentPath: string,
): Promise<SubscriptionCredentialHome> {
  const canonicalParent = await realpath(parentPath);
  const path = await mkdtemp(join(canonicalParent, ".credentials-"));
  await chmod(path, 0o700);
  return {
    path,
    cleanup: async () => {
      try {
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) await unlink(path);
        else await rm(path, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}

export async function materializeCredentialCopies(
  sandboxPath: string,
  copies: Array<{ sourcePath: string; destinationPath: string }>,
): Promise<void> {
  const requestedSandbox = resolve(sandboxPath);
  const canonicalSandbox = await realpath(sandboxPath);
  for (const copy of copies) {
    const sourceStat = await lstat(copy.sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error("Subscription credential source must be a regular file");
    }

    const destination = resolve(copy.destinationPath);
    if (!isInside(requestedSandbox, destination)) {
      throw new Error("Subscription credential destination escapes the scratch sandbox");
    }
    const destinationParent = dirname(destination);
    await mkdir(destinationParent, { recursive: true, mode: 0o700 });
    const canonicalParent = await realpath(destinationParent);
    if (!isInside(canonicalSandbox, canonicalParent)) {
      throw new Error("Subscription credential destination escapes the scratch sandbox");
    }
    await copyFile(copy.sourcePath, destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o600);
  }
}
