export type ForgeReviewFile = {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  diff?: string;
};

export type ForgePullRequest = {
  id: string;
  title?: string;
  url?: string;
  state?: string;
  number?: string;
  sourceBranch?: string;
  targetBranch?: string;
};

export type ForgeReviewMetadata = {
  changedFiles: ForgeReviewFile[];
  pullRequests: ForgePullRequest[];
  ciNotes: string[];
  runId?: string;
  taskId?: string;
  agentId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function resolveStringFromRecord(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString((record as Record<string, unknown>)[key]);
    if (value !== null) {
      return value;
    }
  }

  return undefined;
}

function parseReviewFile(raw: unknown): ForgeReviewFile | null {
  if (typeof raw === "string") {
    const path = asString(raw);
    return path ? { path } : null;
  }

  if (!isRecord(raw)) {
    return null;
  }

  const path =
    asString(raw.path) ??
    asString(raw.file) ??
    asString(raw.name) ??
    asString(raw.filename);

  if (!path) {
    return null;
  }

  const status = asString(raw.status) ?? asString(raw.state);
  const additions = asNumber(raw.additions);
  const deletions = asNumber(raw.deletions);
  const changes = asNumber(raw.changes);
  const diff = asString(raw.diff) ?? asString(raw.patch);

  return {
    path,
    status: status ?? undefined,
    additions,
    deletions,
    changes,
    diff: diff ?? undefined,
  };
}

function parsePullRequest(raw: unknown): ForgePullRequest | null {
  if (typeof raw === "string") {
    const url = asString(raw);
    return url
      ? {
          id: url,
          url,
        }
      : null;
  }

  if (!isRecord(raw)) {
    return null;
  }

  const url = asString(raw.url) ?? asString(raw.link) ?? asString(raw.htmlUrl) ?? null;
  const title = asString(raw.title) ?? asString(raw.summary);
  const state = asString(raw.state) ?? asString(raw.status);
  const sourceBranch = asString(raw.sourceBranch) ?? asString(raw.source);
  const targetBranch = asString(raw.targetBranch) ?? asString(raw.target);

  const number = (() => {
    const fromNumber = asNumber(raw.number);
    if (fromNumber !== undefined) {
      return String(fromNumber);
    }

    const fromId = asString(raw.number);
    return fromId ?? asString(raw.prNumber) ?? "";
  })();

  const id =
    asString(raw.id) ??
    asString(raw.prId) ??
    number ??
    (title ? `${title}`.slice(0, 32) : "");

  if (!id && !url) {
    return null;
  }

  return {
    id: id || url || "pr",
    title: title || undefined,
    url: url || undefined,
    state: state || undefined,
    number: number || undefined,
    sourceBranch: sourceBranch || undefined,
    targetBranch: targetBranch || undefined,
  };
}

function parseUnknownList(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function normalizeCiNotes(raw: unknown): string[] {
  const notes = parseUnknownList(raw)
    .map((entry) => asString(entry))
    .filter((value): value is string => value !== null);

  return notes.slice(0, 25);
}

export function parseForgeRevisionReviewMetadata(metadata: unknown): ForgeReviewMetadata {
  if (!isRecord(metadata)) {
    return {
      changedFiles: [],
      pullRequests: [],
      ciNotes: [],
      runId: undefined,
      taskId: undefined,
      agentId: undefined,
    };
  }

  const record = metadata as Record<string, unknown>;

  const rawFiles =
    parseUnknownList(record.files) || parseUnknownList(record.changedFiles) || parseUnknownList(record.fileChanges);

  const rawPullRequests =
    parseUnknownList(record.pullRequests) || parseUnknownList(record.prs) || parseUnknownList(record.prList);

  const ciRawNotes = record.ciNotes ?? record.notes ?? record.summary ?? record.reviewNotes;

  const runId = resolveStringFromRecord(record, ["runId", "run_id"]);
  const taskId = resolveStringFromRecord(record, ["taskId", "task_id"]);
  const agentId = resolveStringFromRecord(record, ["agentId", "agent_id"]);

  return {
    changedFiles: rawFiles
      .map(parseReviewFile)
      .filter((item): item is ForgeReviewFile => item !== null)
      .slice(0, 75),
    pullRequests: rawPullRequests
      .map(parsePullRequest)
      .filter((item): item is ForgePullRequest => item !== null)
      .slice(0, 25),
    ciNotes: normalizeCiNotes(ciRawNotes),
    runId,
    taskId,
    agentId,
  };
}

export function formatDuration(
  startedAt?: string | Date | null,
  completedAt?: string | Date | null
): string {
  const parseTime = (value: string | Date | null | undefined) => {
    if (typeof value === "string") {
      return Date.parse(value);
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    return Number.NaN;
  };

  if (!startedAt || !completedAt) {
    return "N/A";
  }

  const start = parseTime(startedAt);
  const end = parseTime(completedAt);

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return "N/A";
  }

  const delta = end - start;
  const totalSeconds = Math.max(0, Math.floor(delta / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${seconds}s`;
}
