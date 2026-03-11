import { randomUUID } from "node:crypto";

import { z } from "zod";

import { generateSignature } from "./outbound-webhook";

export const BOB_CONTROL_SIGNATURE_HEADER = "X-Kanbanger-Signature";
export const BOB_CONTROL_TIMESTAMP_HEADER = "X-Kanbanger-Timestamp";
export const BOB_CONTROL_IDEMPOTENCY_HEADER = "Idempotency-Key";

const bobIssueSessionSnapshotSchema = z.object({
  issueId: z.string(),
  issueIdentifier: z.string(),
  executionBackend: z.literal("bob"),
  taskRunId: z.string().nullable(),
  sessionId: z.string().nullable(),
  sessionUrl: z.string().url().nullable(),
  workflowStatus: z.string().nullable(),
  runStatus: z.string().nullable(),
  latestSummary: z.string().nullable(),
});

const bobErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export interface BobControlClientConfig {
  baseUrl: string;
  sharedSecret: string;
  timeoutMs?: number;
}

export interface BobControlClientDeps {
  fetch?: typeof fetch;
  now?: () => number;
  randomUUID?: () => string;
}

export interface BobIssueActor {
  id: string;
  name?: string;
  email?: string;
}

export interface BobRepositoryRef {
  id?: string;
  fullName?: string;
  url?: string;
  defaultBranch?: string;
}

export interface BobIssueSessionCommandInput {
  workspaceId: string;
  projectId: string;
  issueId: string;
  issueIdentifier: string;
  actor: BobIssueActor;
  repository?: BobRepositoryRef;
}

export interface BobStopIssueSessionInput extends BobIssueSessionCommandInput {
  reason?: string;
}

export interface BobGetIssueSessionInput {
  workspaceId: string;
  projectId: string;
  issueId: string;
  issueIdentifier?: string;
}

export type BobIssueSessionSnapshot = z.infer<
  typeof bobIssueSessionSnapshotSchema
>;

export interface BobControlSignatureInput {
  method: string;
  path: string;
  timestamp: string;
  idempotencyKey: string;
  body: string;
}

export class BobControlError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "BobControlError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

function getCanonicalPath(input: string): string {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const url = new URL(input);
    return `${url.pathname}${url.search}`;
  }

  return input.startsWith("/") ? input : `/${input}`;
}

function buildBobControlCanonicalString(
  input: BobControlSignatureInput,
): string {
  return [
    input.method.toUpperCase(),
    getCanonicalPath(input.path),
    input.timestamp,
    input.idempotencyKey,
    input.body,
  ].join("\n");
}

export function buildBobControlSignature(
  input: BobControlSignatureInput,
  secret: string,
): string {
  return generateSignature(buildBobControlCanonicalString(input), secret);
}

function buildControlUrl(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

async function parseErrorResponse(
  response: Response,
): Promise<{
  code: string;
  message: string;
  details?: unknown;
}> {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    const json = await response.json().catch(() => null);
    const parsed = bobErrorResponseSchema.safeParse(json);

    if (parsed.success) {
      return {
        code: parsed.data.error.code ?? "BOB_CONTROL_REQUEST_FAILED",
        message:
          parsed.data.error.message ??
          `Bob control request failed with status ${response.status}`,
        details: parsed.data.error.details,
      };
    }
  }

  const text = await response.text().catch(() => "");
  return {
    code: "BOB_CONTROL_REQUEST_FAILED",
    message: text || `Bob control request failed with status ${response.status}`,
  };
}

function makeAbortSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

export function createBobControlClient(
  config: BobControlClientConfig,
  deps: BobControlClientDeps = {},
) {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const createIdempotencyKey = deps.randomUUID ?? randomUUID;

  const request = async (
    method: "GET" | "POST",
    path: string,
    bodyInput?: unknown,
  ): Promise<BobIssueSessionSnapshot> => {
    const url = buildControlUrl(config.baseUrl, path);
    const body =
      method === "GET" || bodyInput === undefined ? "" : JSON.stringify(bodyInput);
    const timestamp = String(now());
    const idempotencyKey = createIdempotencyKey();
    const signature = buildBobControlSignature(
      {
        method,
        path: `${url.pathname}${url.search}`,
        timestamp,
        idempotencyKey,
        body,
      },
      config.sharedSecret,
    );
    const headers: Record<string, string> = {
      Accept: "application/json",
      [BOB_CONTROL_TIMESTAMP_HEADER]: timestamp,
      [BOB_CONTROL_IDEMPOTENCY_HEADER]: idempotencyKey,
      [BOB_CONTROL_SIGNATURE_HEADER]: signature,
    };

    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
    }

    const { signal, cleanup } = makeAbortSignal(
      config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetchImpl(url.toString(), {
        method,
        headers,
        body: method === "GET" ? undefined : body,
        signal,
      });

      if (!response.ok) {
        const error = await parseErrorResponse(response);
        throw new BobControlError(error.message, {
          status: response.status,
          code: error.code,
          details: error.details,
        });
      }

      const json = await response.json();
      return bobIssueSessionSnapshotSchema.parse(json);
    } catch (error) {
      if (error instanceof BobControlError) {
        throw error;
      }

      throw new BobControlError("Bob control request failed", {
        status: 503,
        code: "BOB_CONTROL_UNAVAILABLE",
        cause: error,
      });
    } finally {
      cleanup();
    }
  };

  return {
    startIssueSession(input: BobIssueSessionCommandInput) {
      return request("POST", "/api/integrations/kanbanger/issues/start", input);
    },
    resumeIssueSession(input: BobIssueSessionCommandInput) {
      return request("POST", "/api/integrations/kanbanger/issues/resume", input);
    },
    stopIssueSession(input: BobStopIssueSessionInput) {
      return request("POST", "/api/integrations/kanbanger/issues/stop", input);
    },
    getIssueSession(input: BobGetIssueSessionInput) {
      const params = new URLSearchParams({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        issueId: input.issueId,
      });

      if (input.issueIdentifier) {
        params.set("issueIdentifier", input.issueIdentifier);
      }

      return request(
        "GET",
        `/api/integrations/kanbanger/issues/session?${params.toString()}`,
      );
    },
  };
}
