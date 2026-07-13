import { createServer   } from "node:http";
import type {IncomingMessage, ServerResponse} from "node:http";
import { fileURLToPath } from "node:url";

export const runtimeStatusValues = [
  "started",
  "working",
  "blocked",
  "review_ready",
  "completed",
  "failed",
] as const;

export type RuntimeStatus = (typeof runtimeStatusValues)[number];

export interface MirrorRuntimeEventInput {
  sessionId?: string;
  taskRunId?: string;
  threadId?: string;
  status: RuntimeStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeMirrorRepository {
  mirrorEvent(event: MirrorRuntimeEventInput): Promise<{ ok: true }>;
}

export interface SqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface SqlClientLike {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<SqlQueryResult<T>>;
  release(): void;
}

export interface SqlPoolLike {
  connect(): Promise<SqlClientLike>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function mapChatStatus(status: RuntimeStatus) {
  if (status === "completed" || status === "failed") return "stopped";
  // Paused awaiting a human decision — surface the distinct session status
  // instead of collapsing it into a generic "running".
  if (status === "blocked") return "blocked";
  return "running";
}

function mapWorkflowStatus(status: RuntimeStatus) {
  switch (status) {
    case "started":
    case "working":
      return "working";
    case "blocked":
      return "blocked";
    case "review_ready":
      return "awaiting_review";
    case "completed":
      return "completed";
    case "failed":
      return "blocked";
  }
}

function mapTaskRunStatus(status: RuntimeStatus) {
  switch (status) {
    case "started":
    case "working":
    case "review_ready":
      return "running";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

function assertMirrorRuntimeEventInput(value: unknown): MirrorRuntimeEventInput {
  if (!value || typeof value !== "object") {
    throw new HttpError(400, "Invalid request body");
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.status !== "string" ||
    !runtimeStatusValues.includes(candidate.status as RuntimeStatus)
  ) {
    throw new HttpError(400, "Invalid status");
  }
  if (typeof candidate.message !== "string" || candidate.message.length === 0) {
    throw new HttpError(400, "message is required");
  }
  if (
    typeof candidate.sessionId !== "string" &&
    typeof candidate.taskRunId !== "string"
  ) {
    throw new HttpError(400, "sessionId or taskRunId is required");
  }

  return {
    sessionId:
      typeof candidate.sessionId === "string" ? candidate.sessionId : undefined,
    taskRunId:
      typeof candidate.taskRunId === "string" ? candidate.taskRunId : undefined,
    threadId:
      typeof candidate.threadId === "string" ? candidate.threadId : undefined,
    status: candidate.status as RuntimeStatus,
    message: candidate.message,
    details:
      candidate.details && typeof candidate.details === "object"
        ? (candidate.details as Record<string, unknown>)
        : undefined,
  };
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

export function createBobRuntimeMirrorSidecar(input: {
  bypassToken: string;
  repository: RuntimeMirrorRepository;
}) {
  const expectedAuthorization = `Bearer bob-auth-bypass:${input.bypassToken}`;

  return {
    async handle(request: Request): Promise<Response> {
      if (request.method !== "POST") {
        return jsonResponse(405, { error: "Method Not Allowed" });
      }

      if (request.headers.get("authorization") !== expectedAuthorization) {
        return jsonResponse(401, { error: "Unauthorized" });
      }

      try {
        const event = assertMirrorRuntimeEventInput(await request.json());
        const result = await input.repository.mirrorEvent(event);
        return jsonResponse(200, result);
      } catch (error) {
        if (error instanceof HttpError) {
          return jsonResponse(error.status, { error: error.message });
        }
        const message =
          error instanceof Error ? error.message : "Internal server error";
        console.error("[bob-runtime-mirror-sidecar] request failed", {
          message,
          error,
        });
        return jsonResponse(500, { error: message });
      }
    },
  };
}

function parseNextSeq(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`Invalid next_seq value: ${String(value)}`);
}

export async function mirrorRuntimeEventWithPostgres(
  pool: SqlPoolLike,
  input: {
    bypassUserId: string;
    event: MirrorRuntimeEventInput;
  },
): Promise<{ ok: true }> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const taskRunResult = input.event.taskRunId
      ? await client.query<{ id: string; session_id: string | null }>(
          "select id, session_id from task_runs where id = $1 limit 1",
          [input.event.taskRunId],
        )
      : input.event.sessionId
        ? await client.query<{ id: string; session_id: string | null }>(
            "select id, session_id from task_runs where session_id = $1 order by created_at desc limit 1",
            [input.event.sessionId],
          )
        : { rows: [] };

    const taskRun = taskRunResult.rows[0] ?? null;
    const sessionId = input.event.sessionId ?? taskRun?.session_id ?? null;
    if (!sessionId) {
      throw new HttpError(404, "Session not found");
    }

    const sessionResult = await client.query<{
      id: string;
      user_id: string;
      next_seq: number;
    }>(
      "select id, user_id, next_seq from chat_conversations where id = $1 limit 1",
      [sessionId],
    );

    const session = sessionResult.rows[0] ?? null;
    if (!session) {
      throw new HttpError(404, "Session not found");
    }
    if (session.user_id !== input.bypassUserId) {
      throw new HttpError(403, "Forbidden");
    }
    const nextSeq = parseNextSeq(session.next_seq);

    const now = new Date();
    const blockedReason =
      input.event.status === "blocked" || input.event.status === "failed"
        ? input.event.message
        : null;

    await client.query(
      `update chat_conversations
       set status = $2,
           workflow_status = $3,
           status_message = $4,
           last_activity_at = $5,
           blocked_reason = $6,
           updated_at = $5
       where id = $1`,
      [
        sessionId,
        mapChatStatus(input.event.status),
        mapWorkflowStatus(input.event.status),
        input.event.message,
        now,
        blockedReason,
      ],
    );

    await client.query(
      "update chat_conversations set next_seq = $2 where id = $1",
      [sessionId, nextSeq + 1],
    );

    await client.query(
      `insert into session_events (session_id, seq, direction, event_type, payload, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        sessionId,
        nextSeq,
        "system",
        "state",
        JSON.stringify({
          type: "t3_runtime_event",
          status: input.event.status,
          message: input.event.message,
          threadId: input.event.threadId ?? null,
          taskRunId: taskRun?.id ?? input.event.taskRunId ?? null,
          details: input.event.details ?? null,
        }),
        now,
      ],
    );

    if (taskRun?.id) {
      await client.query(
        `update task_runs
         set status = $2,
             blocked_reason = $3,
             completed_at = case when $4 then $5 else completed_at end,
             updated_at = $5
         where id = $1`,
        [
          taskRun.id,
          mapTaskRunStatus(input.event.status),
          blockedReason,
          input.event.status === "completed",
          now,
        ],
      );
    }

    await client.query("commit");
    return { ok: true };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      console.error("[bob-runtime-mirror-sidecar] rollback failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function startBobRuntimeMirrorSidecarFromEnv() {
  const bypassToken = process.env.BOB_AUTH_BYPASS_TOKEN?.trim();
  const bypassUserId = process.env.BOB_AUTH_BYPASS_USER_ID?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const trimmedHost = process.env.BOB_RUNTIME_MIRROR_HOST?.trim();
  const host = trimmedHost && trimmedHost.length > 0 ? trimmedHost : "127.0.0.1";
  const trimmedPort = process.env.BOB_RUNTIME_MIRROR_PORT?.trim();
  const port = Number(trimmedPort && trimmedPort.length > 0 ? trimmedPort : "3301");

  if (!bypassToken) {
    throw new Error("BOB_AUTH_BYPASS_TOKEN is required");
  }
  if (!bypassUserId) {
    throw new Error("BOB_AUTH_BYPASS_USER_ID is required");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  const sidecar = createBobRuntimeMirrorSidecar({
    bypassToken,
    repository: {
      mirrorEvent(event) {
        return mirrorRuntimeEventWithPostgres(pool, {
          bypassUserId,
          event,
        });
      },
    },
  });

  const server = createServer((req, res) => {
    (async () => {
      const response = await sidecar.handle(await toRequest(req));
      await writeNodeResponse(res, response);
    })().catch((error: unknown) => {
      console.error("[bob-runtime-mirror-sidecar] request handler failed:", error);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve());
  });

  console.log(
    `[bob-runtime-mirror-sidecar] listening on http://${host}:${port}`,
  );
  return server;
}

async function toRequest(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  return new Request(`http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`, {
    method: req.method,
    headers,
    body,
    duplex: "half",
  });
}

async function writeNodeResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startBobRuntimeMirrorSidecarFromEnv().catch((error) => {
    console.error("[bob-runtime-mirror-sidecar] failed to start", error);
    process.exitCode = 1;
  });
}
