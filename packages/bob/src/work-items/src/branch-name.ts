/**
 * Deterministic git branch naming for Bob task runs.
 *
 * Every dispatch path must produce byte-identical branch names for the same
 * (identifier, title) pair so a run's branch is predictable regardless of which
 * code path created it. The auto-drain executor (apps/bob-execution
 * taskExecutor) and the headless public-API dispatch (packages/bob/src/api
 * publicApi.dispatchExecution) both build `bob/<identifier>/<slug>` — this is
 * the single source of truth for that shape.
 *
 * Tracker-imported work (a Kanbanger/Linear issue such as `GMA-612`) uses a
 * second shape, `bob/GMA-612-<slug>`. Kanbanger links git activity to an issue
 * by matching `[A-Z]{2,10}-\d+` — case-sensitively — in the PR title, the PR
 * head ref and commit messages, and ForgeGraph forwards its PR/CI/deploy events
 * on the same basis. So the identifier must appear in the branch verbatim and
 * upper-case: a lower-cased `gma-612-…` would not match, and CI runs on a
 * branch with no PR yet would never reach the issue. The `bob/` namespace is
 * kept on purpose: the runner force-pushes its branch, and an un-prefixed
 * `GMA-612-…` could collide with a human's branch for the same issue.
 */

/**
 * Lower-case, hyphenate and truncate free text into a git-ref-safe slug.
 * Matches the historical taskExecutor slug rules exactly (max 50 chars).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Build the feature branch for a task run: `bob/<identifier>/<slugified title>`.
 * `identifier` is the short work-item identifier (e.g. a planning identifier
 * like "BOB-27", or the first 8 chars of a work-item UUID for dispatch).
 */
export function generateBranchName(identifier: string, title: string): string {
  return `bob/${identifier}/${slugify(title)}`;
}

/**
 * A tracker issue identifier (`GMA-612`). Same alphabet as Kanbanger's own
 * extractor (`[A-Z]{2,10}-\d+`), anchored, so anything this accepts Kanbanger
 * will find again in a title, branch or commit message.
 */
const TRACKER_IDENTIFIER = /^[A-Z]{2,10}-\d+$/;

export function isTrackerIdentifier(value: string | null | undefined): value is string {
  return typeof value === "string" && TRACKER_IDENTIFIER.test(value);
}

/**
 * The human identifier (`GMA-612`) of a tracker-imported work item, or null.
 *
 * Imported rows are keyed by the issue UUID (`external_id`), so the identifier
 * has to be recovered: `sourceMetadata.trackerIdentifier` (recorded at import
 * since this change), else an identifier-keyed `external_id` (rows imported
 * before the UUID switch), else the `/issue/GMA-612` tail of the tracker URL
 * (every Kanbanger import since then carries it). Null for internal items.
 */
export function trackerIdentifierOf(item: {
  externalProvider?: string | null;
  externalId?: string | null;
  externalUrl?: string | null;
  sourceMetadata?: unknown;
}): string | null {
  if (item.externalProvider !== "linear") return null;
  const meta = item.sourceMetadata as Record<string, unknown> | null | undefined;
  const recorded = meta?.trackerIdentifier;
  if (isTrackerIdentifier(recorded as string | undefined)) return recorded as string;
  if (isTrackerIdentifier(item.externalId)) return item.externalId;
  const fromUrl = /\/issue\/([A-Z]{2,10}-\d+)(?:[/?#]|$)/.exec(item.externalUrl ?? "");
  return fromUrl?.[1] ?? null;
}

/** Feature branch for a tracker-imported task: `bob/GMA-612-<slugified title>`. */
export function generateTrackerBranchName(identifier: string, title: string): string {
  const slug = slugify(title);
  return slug ? `bob/${identifier}-${slug}` : `bob/${identifier}`;
}
