/**
 * Pure layout math for the spectacle repo view — a gource-lite radial tree
 * grown from the file paths a session has touched. Deterministic (hash-based
 * angles) so the constellation is stable frame-to-frame and across polls;
 * only NEW paths move the picture. No DOM, unit-tested.
 */

export interface RepoNode {
  /** Full path — also the node id. Directories keep a trailing slash-less path. */
  path: string;
  /** Last path segment, drawn as the label when hot. */
  name: string;
  /** Parent directory path, or null for the repo root. */
  parent: string | null;
  depth: number;
  isFile: boolean;
  /** Cluster-local unit coordinates, roughly within [-1, 1]. */
  x: number;
  y: number;
}

/** Deterministic 0..1 hash — stable angles without Math.random. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Radial tree: the root sits at (0,0); each child leaves its parent at the
 * parent's heading ± a spread that narrows with depth, stepping outward a
 * fixed distance per level. Siblings fan out by name hash, so deep trees read
 * as branches rather than spokes.
 */
export function buildRepoLayout(paths: string[], maxFiles = 80): Map<string, RepoNode> {
  const nodes = new Map<string, RepoNode>();
  const headings = new Map<string, number>(); // path -> outward angle
  nodes.set("", { path: "", name: "", parent: null, depth: 0, isFile: false, x: 0, y: 0 });
  headings.set("", 0);

  for (const raw of paths.slice(0, maxFiles)) {
    const segments = raw.split("/").filter(Boolean);
    if (!segments.length) continue;
    let parentPath = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const path = parentPath ? `${parentPath}/${seg}` : seg;
      if (!nodes.has(path)) {
        const parent = nodes.get(parentPath)!;
        const spread = i === 0 ? Math.PI * 2 : Math.PI / (1 + i * 0.8);
        const angle = (headings.get(parentPath) ?? 0) + (hash01(path) - 0.5) * spread;
        const step = i === 0 ? 0.34 : 0.26 / (1 + i * 0.25);
        nodes.set(path, {
          path,
          name: seg,
          parent: parentPath,
          depth: i + 1,
          isFile: i === segments.length - 1,
          x: parent.x + Math.cos(angle) * step,
          y: parent.y + Math.sin(angle) * step,
        });
        headings.set(path, angle);
      } else if (i === segments.length - 1) {
        // a path can first appear as a directory prefix, then as a file
        nodes.get(path)!.isFile = true;
      }
      parentPath = path;
    }
  }
  return nodes;
}

/**
 * Fingerprint one session's file_changes payload — when it changes for a
 * path, that file was just touched and should reheat + get a beam.
 */
export function touchFingerprints(
  topFiles: { path: string; added: number; removed: number }[],
): Map<string, number> {
  const fp = new Map<string, number>();
  for (const f of topFiles) fp.set(f.path, f.added * 100003 + f.removed);
  return fp;
}
