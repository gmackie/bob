import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

type WorkflowSource = "bob" | "ooda";
type ProvenanceQuality = "direct" | "reconstructed";
type AgentRuntime = "codex" | "claude" | "cursor" | "grok" | "opencode" | "smol-agent" | "other";

type AgentRunPayload = {
  runtime: AgentRuntime;
  status: "success" | "failure" | "cancelled" | "blocked";
  durationMs: number;
  turnCount: number;
};

type ToolInvocationPayload = {
  toolKind: "skill" | "mcp" | "computer_use" | "shell" | "other";
  resourceIdDigest: string | null;
  outcome: "success" | "failure" | "cancelled";
  durationMs: number;
};

type EngineeringOutcomePayload = {
  outcomeType: "tests" | "build" | "deploy" | "review" | "promotion";
  result: "pass" | "fail" | "partial";
  durationMs: number;
};

type WorkflowEventInput = {
  source: WorkflowSource;
  identity: string;
  observedAt: string;
  sessionId: string | null;
  projectId: string | null;
  provenanceQuality: ProvenanceQuality;
} & (
  | { kind: "agent_run"; payload: AgentRunPayload }
  | { kind: "tool_invocation"; payload: ToolInvocationPayload }
  | { kind: "engineering_outcome"; payload: EngineeringOutcomePayload }
);

type WorkflowRecord = {
  schemaVersion: 1;
  recordId: string;
  source: WorkflowSource;
  observedAt: string;
  sessionIdDigest: string | null;
  projectIdDigest: string | null;
  provenanceQuality: ProvenanceQuality;
  kind: WorkflowEventInput["kind"];
  payload: AgentRunPayload | ToolInvocationPayload | EngineeringOutcomePayload;
};

const INPUT_KEYS = [
  "source", "identity", "observedAt", "sessionId", "projectId",
  "provenanceQuality", "kind", "payload",
];
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 32 * 1024;

function exactKeys(value: unknown, keys: string[], name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${name} has unexpected keys`);
  }
}

function enumValue(value: unknown, values: readonly string[], name: string): asserts value is string {
  if (typeof value !== "string" || !values.includes(value)) throw new TypeError(`${name} is unsupported`);
}

function boundedIdentity(value: unknown, name: string, nullable = false): asserts value is string | null {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024) {
    throw new TypeError(`${name} must be a bounded identity`);
  }
}

function nonNegativeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${name} must be a non-negative integer`);
}

function timestamp(value: unknown) {
  if (typeof value !== "string") throw new TypeError("observedAt must be a UTC RFC3339 timestamp");
  const match = UTC_TIMESTAMP.exec(value);
  const parsed = new Date(value);
  const [year, month, day, hour, minute, second] = match ? match.slice(1).map(Number) : [];
  if (!match || !Number.isFinite(parsed.getTime())
    || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day || parsed.getUTCHours() !== hour
    || parsed.getUTCMinutes() !== minute || parsed.getUTCSeconds() !== second) {
    throw new TypeError("observedAt must be a UTC RFC3339 timestamp");
  }
}

function validatePayload(kind: string, payload: unknown) {
  if (kind === "agent_run") {
    exactKeys(payload, ["runtime", "status", "durationMs", "turnCount"], "agent_run payload");
    enumValue(payload.runtime, ["codex", "claude", "cursor", "grok", "opencode", "smol-agent", "other"], "runtime");
    enumValue(payload.status, ["success", "failure", "cancelled", "blocked"], "status");
    nonNegativeInteger(payload.durationMs, "durationMs");
    nonNegativeInteger(payload.turnCount, "turnCount");
    return;
  }
  if (kind === "tool_invocation") {
    exactKeys(payload, ["toolKind", "resourceIdDigest", "outcome", "durationMs"], "tool_invocation payload");
    enumValue(payload.toolKind, ["skill", "mcp", "computer_use", "shell", "other"], "toolKind");
    if (payload.resourceIdDigest !== null
      && (typeof payload.resourceIdDigest !== "string" || !DIGEST.test(payload.resourceIdDigest))) {
      throw new TypeError("resourceIdDigest must be a digest or null");
    }
    enumValue(payload.outcome, ["success", "failure", "cancelled"], "outcome");
    nonNegativeInteger(payload.durationMs, "durationMs");
    return;
  }
  if (kind === "engineering_outcome") {
    exactKeys(payload, ["outcomeType", "result", "durationMs"], "engineering_outcome payload");
    enumValue(payload.outcomeType, ["tests", "build", "deploy", "review", "promotion"], "outcomeType");
    enumValue(payload.result, ["pass", "fail", "partial"], "result");
    nonNegativeInteger(payload.durationMs, "durationMs");
    return;
  }
  throw new TypeError("workflow event kind is unsupported");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(namespace: string, value: unknown) {
  return `sha256:${createHash("sha256").update(`${namespace}\0${canonicalJson(value)}`).digest("hex")}`;
}

export function digestSkillfleetResourceId(value: string): string {
  boundedIdentity(value, "resourceId");
  return digest("skillfleet-resource-v1", value);
}

export function normalizeSkillfleetRuntime(value: string): AgentRuntime {
  const runtime = value.trim().toLowerCase();
  if (runtime.includes("codex")) return "codex";
  if (runtime.includes("claude")) return "claude";
  if (runtime.includes("cursor")) return "cursor";
  if (runtime.includes("grok") || runtime.includes("xai")) return "grok";
  if (runtime.includes("opencode")) return "opencode";
  if (runtime.includes("smol")) return "smol-agent";
  return "other";
}

function buildRecord(input: WorkflowEventInput): WorkflowRecord {
  exactKeys(input, INPUT_KEYS, "workflow event");
  enumValue(input.source, ["bob", "ooda"], "source");
  boundedIdentity(input.identity, "identity");
  timestamp(input.observedAt);
  boundedIdentity(input.sessionId, "sessionId", true);
  boundedIdentity(input.projectId, "projectId", true);
  enumValue(input.provenanceQuality, ["direct", "reconstructed"], "provenanceQuality");
  enumValue(input.kind, ["agent_run", "tool_invocation", "engineering_outcome"], "kind");
  validatePayload(input.kind, input.payload);
  const identity = {
    source: input.source,
    identity: input.identity,
    observedAt: input.observedAt,
    kind: input.kind,
    payload: input.payload,
  };
  return {
    schemaVersion: 1,
    recordId: digest("skillfleet-workflow-record-v1", identity),
    source: input.source,
    observedAt: input.observedAt,
    sessionIdDigest: input.sessionId === null ? null : digest("skillfleet-session-v1", input.sessionId),
    projectIdDigest: input.projectId === null ? null : digest("skillfleet-project-v1", input.projectId),
    provenanceQuality: input.provenanceQuality,
    kind: input.kind,
    payload: input.payload,
  };
}

async function appendRecord(journalPath: string, record: WorkflowRecord) {
  if (!isAbsolute(journalPath) || journalPath.includes("\0") || /[\r\n]/.test(journalPath)) {
    throw new TypeError("journal path must be explicit and absolute");
  }
  const directory = dirname(journalPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error("journal directory must be a real directory");
  }
  await chmod(directory, 0o700);
  const serialized = `${JSON.stringify(record)}\n`;
  const bytes = Buffer.from(serialized, "utf8");
  if (bytes.byteLength > MAX_RECORD_BYTES) throw new Error("workflow record exceeds limit");
  const handle = await open(
    journalPath,
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("journal path must be a regular file");
    await handle.chmod(0o600);
    const result = await handle.write(bytes, 0, bytes.byteLength, null);
    if (result.bytesWritten !== bytes.byteLength) throw new Error("workflow record append was incomplete");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function emitSkillfleetWorkflowEvent(
  input: WorkflowEventInput,
  { journalPath = process.env.SKILLFLEET_WORKFLOW_JOURNAL ?? null }: { journalPath?: string | null } = {},
): Promise<{ state: "disabled" } | { state: "rejected" } | { state: "failed" } | { state: "written"; recordId: string }> {
  if (journalPath === null || journalPath === "") return { state: "disabled" };
  let record: WorkflowRecord;
  try {
    record = buildRecord(input);
  } catch {
    return { state: "rejected" };
  }
  try {
    await appendRecord(journalPath, record);
    return { state: "written", recordId: record.recordId };
  } catch {
    return { state: "failed" };
  }
}

export type { WorkflowEventInput, WorkflowRecord };
