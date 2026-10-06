/**
 * Tracker (Kanbanger/Linear) naming for the PRs and commits a Bob session
 * produces.
 *
 * Kanbanger links git activity to an issue by finding `[A-Z]{2,10}-\d+` —
 * case-sensitively — in a PR's title, head ref and body and in commit
 * messages, and ForgeGraph forwards its PR/CI/deploy events on the same basis.
 * So a session for an imported issue must put its identifier (`GMA-612`) in
 * each of those places: the server already names the branch
 * `bob/GMA-612-<slug>`; this module titles the PR `GMA-612: <title>` and makes
 * sure the pushed head carries a `Refs: GMA-612` trailer.
 *
 * A session is tracker work only when the gateway marked it so (`issueId` is
 * set exactly when the work item was imported from the tracker) AND its
 * identifier is tracker-shaped. Internal items can have `KEY-N` identifiers
 * too, which is why the identifier alone is not enough — and why everything
 * here is a no-op for them.
 */

const TRACKER_IDENTIFIER = /^[A-Z]{2,10}-\d+$/;

export interface TrackerSessionFields {
  issueId?: string;
  identifier?: string;
  title?: string;
}

/** `GMA-612` for a session on a tracker-imported issue, otherwise null. */
export function trackerIdentifierForSession(session: TrackerSessionFields): string | null {
  if (!session.issueId || !session.identifier) return null;
  return TRACKER_IDENTIFIER.test(session.identifier) ? session.identifier : null;
}

/**
 * PR title. Tracker work: `GMA-612: <title>` (the session title already reads
 * `GMA-612: <title>`, so the prefix is not doubled). Everything else keeps the
 * historical `[Bob] <title>`.
 */
export function pullRequestTitle(session: TrackerSessionFields, fallback: string): string {
  const title = session.title ?? fallback;
  const identifier = trackerIdentifierForSession(session);
  if (!identifier) return `[Bob] ${title}`;
  const bare = title.startsWith(`${identifier}: `) ? title.slice(identifier.length + 2) : title;
  return `${identifier}: ${bare}`;
}

/** PR body, with a `Refs:` line for tracker work. */
export function pullRequestBody(session: TrackerSessionFields, body: string): string {
  const identifier = trackerIdentifierForSession(session);
  if (!identifier || body.includes(`Refs: ${identifier}`)) return body;
  return `${body.trimEnd()}\n\nRefs: ${identifier}`;
}

/** The trailer every commit for this issue should carry. */
export function commitTrailer(identifier: string): string {
  return `Refs: ${identifier}`;
}

/** Prompt line asking the agent to reference the issue in its commits. */
export function commitTrailerInstruction(session: TrackerSessionFields): string | null {
  const identifier = trackerIdentifierForSession(session);
  return identifier
    ? `\nCommit messages: end every commit message with the trailer line \`${commitTrailer(identifier)}\` (after a blank line), so the tracker links the commit to ${identifier}.`
    : null;
}

/**
 * Does any commit message in the pushed range already reference the issue?
 * `log` is `git log --format=%B` output for `origin/<base>..HEAD`.
 */
export function rangeReferencesIssue(log: string, identifier: string): boolean {
  return new RegExp(`(^|[^A-Z0-9])${identifier}(?![0-9])`).test(log);
}
