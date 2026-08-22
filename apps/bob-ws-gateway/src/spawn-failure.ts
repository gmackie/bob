/**
 * A daemon that cannot spawn an agent reports `spawn <bin> ENOENT`. Extract the
 * agent binary so the relay can stop offering that agent type to that host.
 *
 * Why server-side: runners on personal machines sit behind NAT and can be many
 * versions behind (on 2026-08-22 two of them claimed 74 codex sessions they had
 * no binary for). The runner-side guard fixes updated hosts; this makes the
 * gateway learn the same fact from the failures themselves, for any runner.
 */
export function spawnFailureAgent(message: string | undefined): string | null {
  if (!message) return null;
  const m = /spawn\s+([\w.-]+)\s+ENOENT/i.exec(message);
  return m?.[1] ?? null;
}
