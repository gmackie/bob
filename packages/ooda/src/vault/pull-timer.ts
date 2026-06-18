import { pull } from "./git";
import type { VaultConfig } from "./types";

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes

export function startPullTimer(
  vaults: VaultConfig[],
  intervalMs: number = DEFAULT_INTERVAL_MS,
): () => void {
  const timers: ReturnType<typeof setInterval>[] = [];

  for (const vault of vaults) {
    const timer = setInterval(async () => {
      try {
        const result = await pull(vault.path);
        if (result.conflicts) {
          console.log(`[vault-sync] ${vault.name}: conflicts detected`);
        } else if (result.filesChanged > 0) {
          console.log(
            `[vault-sync] ${vault.name}: ${result.filesChanged} files changed`,
          );
        }
      } catch (err) {
        console.error(
          `[vault-sync] ${vault.name}: pull failed —`,
          err instanceof Error ? err.message : err,
        );
      }
    }, intervalMs);

    timers.push(timer);
  }

  return () => {
    for (const timer of timers) {
      clearInterval(timer);
    }
  };
}
