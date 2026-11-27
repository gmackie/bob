export type TaskPane = "brief" | "builder";

export function canPairTaskPanes(usableWidth: number, fontScale: number) {
  // Two readable columns and the gutter, measured inside the shell/sidebar.
  return usableWidth >= 600 * Math.max(1, fontScale);
}

interface BuilderRun {
  id: string;
  sessionId: string | null;
}

// listByWorkItem returns newest first. A newly dispatched session can arrive
// before its run. Never show the previous run's diff beside that session.
export function selectBuilderExecution<T extends BuilderRun>(
  runs: readonly T[],
  currentSessionId: string | null,
  lastTaskSessionId: string | null,
) {
  const run = currentSessionId
    ? runs.find((item) => item.sessionId === currentSessionId)
    : runs[0];
  const sessionId =
    currentSessionId ?? (run ? run.sessionId : lastTaskSessionId);
  return { run, sessionId };
}

interface DiffSource {
  summary?: unknown;
  artifacts?: readonly {
    type: string;
    metadata?: Record<string, unknown> | null;
  }[];
}

function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

// Runner artifacts contain either recorded stats or an inline unified patch.
// A truncated patch is only an excerpt, so do not present its counts as totals.
export function describeBuilderDiff(run: DiffSource): string | null {
  const artifact = run.artifacts?.find((item) => item.type === "diff");
  const metadata = artifact?.metadata;
  const summary =
    run.summary &&
    typeof run.summary === "object" &&
    "files_changed" in run.summary
      ? run.summary.files_changed
      : undefined;
  let files = count(metadata?.files_changed) ?? count(summary);
  let added = count(metadata?.insertions);
  let removed = count(metadata?.deletions);
  const patch = metadata?.content ?? metadata?.patch;
  if (
    typeof patch === "string" &&
    patch.trim() &&
    metadata?.truncated !== true
  ) {
    let fileHeaders = 0;
    let newPaths = 0;
    let insertions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) {
        fileHeaders++;
        inHunk = false;
      } else if (line.startsWith("@@ ")) {
        inHunk = true;
      } else if (inHunk && line.startsWith("+")) {
        insertions++;
      } else if (inHunk && line.startsWith("-")) {
        deletions++;
      } else if (!inHunk && line.startsWith("+++ ")) {
        newPaths++;
      }
    }
    if (fileHeaders || newPaths) {
      files ??= fileHeaders || newPaths;
      added ??= insertions;
      removed ??= deletions;
    }
  }
  const stats = [
    files === undefined
      ? null
      : `${files} ${files === 1 ? "file" : "files"} changed`,
    added === undefined ? null : `+${added}`,
    removed === undefined ? null : `−${removed}`,
  ].filter(Boolean);
  return (
    stats.join(" · ") ||
    (artifact
      ? metadata?.truncated
        ? "Partial diff recorded"
        : "Diff recorded"
      : null)
  );
}
