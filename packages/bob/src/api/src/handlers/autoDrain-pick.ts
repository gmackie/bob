// Pure selection helpers for the autonomous backlog driver, split out so they
// can be unit-tested without importing the DB client (which initializes at
// module load).

/** Pick up to `n` items, round-robin across projects so no single project
 *  monopolizes the daily budget. `ready` is assumed oldest-first. */
export function pickAcrossProjects<T extends { projectId: string | null }>(
  ready: T[],
  n: number,
): T[] {
  const byProject = new Map<string, T[]>();
  for (const item of ready) {
    const key = item.projectId ?? "none";
    let bucket = byProject.get(key);
    if (!bucket) {
      bucket = [];
      byProject.set(key, bucket);
    }
    bucket.push(item);
  }
  const queues = [...byProject.values()];
  const picked: T[] = [];
  let idx = 0;
  while (picked.length < n && queues.some((q) => q.length > 0)) {
    const q = queues[idx % queues.length];
    const next = q?.shift();
    if (next) picked.push(next);
    idx++;
  }
  return picked;
}
