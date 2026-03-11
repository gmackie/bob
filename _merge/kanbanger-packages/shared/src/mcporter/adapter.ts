import type {
  McporterCommandSpec,
  McporterPolicy,
  McporterPolicyError,
  McporterRunResult,
  McporterTruncation,
} from "./types";

export const DEFAULT_MAX_OUTPUT_BYTES = 256_000;
export const DEFAULT_MAX_TIMEOUT_MS = 120_000;

export function createDefaultMcporterPolicy(): McporterPolicy {
  return {
    allowedCommands: ["jj", "git", "forgegraph"],
    maxTimeoutMs: DEFAULT_MAX_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  };
}

export function createRequestId(prefix = "mcporter"): string {
  const rand = Math.random().toString(16).slice(2);
  const ts = Date.now().toString(16);
  return `${prefix}_${ts}_${rand}`;
}

export function validateCommandSpec(
  spec: McporterCommandSpec,
  policy: McporterPolicy
): { ok: true } | { ok: false; error: McporterPolicyError } {
  if (!spec.command || typeof spec.command !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "command is required" },
    };
  }

  if (!Array.isArray(spec.args) || spec.args.some((a) => typeof a !== "string")) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "args must be a string array" },
    };
  }

  if (!policy.allowedCommands.includes(spec.command)) {
    return {
      ok: false,
      error: {
        code: "NOT_ALLOWED",
        message: `Command not allowed: ${spec.command}`,
        details: { command: spec.command },
      },
    };
  }

  if (spec.timeoutMs !== undefined && spec.timeoutMs > policy.maxTimeoutMs) {
    return {
      ok: false,
      error: {
        code: "TIMEOUT_TOO_HIGH",
        message: `timeoutMs exceeds policy max (${policy.maxTimeoutMs})`,
        details: { timeoutMs: spec.timeoutMs, maxTimeoutMs: policy.maxTimeoutMs },
      },
    };
  }

  if (spec.maxOutputBytes !== undefined && spec.maxOutputBytes > policy.maxOutputBytes) {
    return {
      ok: false,
      error: {
        code: "OUTPUT_LIMIT_TOO_HIGH",
        message: `maxOutputBytes exceeds policy max (${policy.maxOutputBytes})`,
        details: {
          maxOutputBytes: spec.maxOutputBytes,
          policyMaxOutputBytes: policy.maxOutputBytes,
        },
      },
    };
  }

  return { ok: true };
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (maxBytes <= 0) return { text: "", truncated: text.length > 0 };
  if (utf8ByteLength(text) <= maxBytes) return { text, truncated: false };

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const slice = text.slice(0, mid);
    if (utf8ByteLength(slice) <= maxBytes) low = mid;
    else high = mid - 1;
  }

  return { text: text.slice(0, low), truncated: true };
}

export function clampRunOutput(args: {
  stdout: string;
  stderr: string;
  maxOutputBytes: number;
}): { stdout: string; stderr: string; truncated: McporterTruncation } {
  const maxBytes = args.maxOutputBytes;

  const stdoutTrunc = truncateUtf8(args.stdout, maxBytes);
  const stderrTrunc = truncateUtf8(args.stderr, maxBytes);

  return {
    stdout: stdoutTrunc.text,
    stderr: stderrTrunc.text,
    truncated: {
      stdout: stdoutTrunc.truncated,
      stderr: stderrTrunc.truncated,
    },
  };
}

export function buildResult(args: {
  requestId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAtMs: number;
  finishedAtMs: number;
  maxOutputBytes: number;
}): McporterRunResult {
  const clamped = clampRunOutput({
    stdout: args.stdout,
    stderr: args.stderr,
    maxOutputBytes: args.maxOutputBytes,
  });

  return {
    requestId: args.requestId,
    exitCode: args.exitCode,
    stdout: clamped.stdout,
    stderr: clamped.stderr,
    durationMs: Math.max(0, args.finishedAtMs - args.startedAtMs),
    truncated: clamped.truncated,
  };
}
