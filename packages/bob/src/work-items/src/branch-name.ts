/**
 * Deterministic git branch naming for Bob task runs.
 *
 * Every dispatch path must produce byte-identical branch names for the same
 * (identifier, title) pair so a run's branch is predictable regardless of which
 * code path created it. The auto-drain executor (apps/bob-execution
 * taskExecutor) and the headless public-API dispatch (packages/bob/src/api
 * publicApi.dispatchExecution) both build `bob/<identifier>/<slug>` — this is
 * the single source of truth for that shape.
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
