/**
 * OpenAI-compatible /v1/chat/completions for Bob subscriptions.
 *
 * Apps like PlayTrek can POST here during development, then flip their
 * LLM_BASE_URL to OpenRouter / Bedrock without changing client code.
 */

const ADAPTERS = ["claude", "codex", "grok", "cursor-agent"] as const;
const PREFERRED_RUNNER = "hetzner-bob";
const TOOL_PROFILE = "default";
const SESSION_TIMEOUT_MS = 90_000;
const PENDING_CLAIM_MS = 25_000;
const POLL_MS = 2_000;

export interface OodaOpenAiDevice {
  id: string;
  name?: string | null;
  hostname?: string | null;
  status?: string | null;
  capabilities?: string[] | null;
  lastHeartbeatAt?: Date | string | null;
}

export interface OodaOpenAiSession {
  id: string;
  status: string;
}

export interface OodaOpenAiEvent {
  type: string;
  content: string;
}

export interface OodaOpenAiDispatch {
  listDevices(): Promise<OodaOpenAiDevice[]>;
  createThread(input: {
    title: string;
    slug: string;
  }): Promise<{ id: string } | Array<{ id: string }>>;
  sendPrompt(input: {
    threadId: string;
    runnerId: string;
    adapterId: string;
    toolProfileId: string;
    prompt: string;
  }): Promise<OodaOpenAiSession>;
  listSessions(input: { threadId: string }): Promise<OodaOpenAiSession[]>;
  getSessionEvents(input: { sessionId: string }): Promise<OodaOpenAiEvent[]>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class OodaOpenAiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "invalid_request_error",
  ) {
    super(message);
    this.name = "OodaOpenAiError";
  }
}

export function extractBearerToken(authorization: string | null | undefined): string {
  const raw = (authorization ?? "").trim();
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return raw;
}

export function listOodaOpenAiModels() {
  const created = Math.floor(Date.now() / 1000);
  return ADAPTERS.map((id) => ({
    id,
    object: "model" as const,
    created,
    owned_by: "bob",
  }));
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function toPrompt(body: {
  messages?: Array<{ role?: string; content?: unknown }>;
}): string {
  const messages = body.messages ?? [];
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => messageText(message.content))
    .join("\n\n")
    .trim();
  const rest = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const text = messageText(message.content);
      return message.role === "user" ? text : `${message.role}: ${text}`;
    })
    .join("\n\n")
    .trim();
  if (!rest) {
    throw new OodaOpenAiError(400, "messages must include a user turn");
  }
  return [
    "You are answering an OpenAI-compatible chat completion on hetzner-bob.",
    "Do not use tools. Do not inspect a repo. Reply with only the requested output.",
    system ? `## System\n${system}` : "",
    `## User\n${rest}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function pickAdapters(model: string | undefined, device: OodaOpenAiDevice): string[] {
  const requested = (model ?? "claude").trim().toLowerCase();
  const mapped =
    requested === "cursor" ? "cursor-agent" : requested;
  const preferred = ADAPTERS.includes(mapped as (typeof ADAPTERS)[number])
    ? [mapped, ...ADAPTERS.filter((id) => id !== mapped)]
    : [...ADAPTERS];
  const caps = new Set(
    (device.capabilities ?? []).map((cap) => cap.toLowerCase()),
  );
  if (caps.size === 0) return preferred;
  const available = preferred.filter((adapter) => {
    if (caps.has(adapter)) return true;
    if (adapter === "cursor-agent") {
      return caps.has("cursor") || caps.has("cursor-acp");
    }
    return false;
  });
  return available.length > 0 ? available : preferred;
}

function pickRunner(devices: OodaOpenAiDevice[]): OodaOpenAiDevice {
  const online = devices.filter((device) => device.status !== "offline");
  const needle = PREFERRED_RUNNER;
  const pick =
    online.find(
      (device) =>
        (device.name ?? "").toLowerCase().includes(needle) ||
        (device.hostname ?? "").toLowerCase().includes(needle),
    ) ?? online[0];
  if (!pick) {
    throw new OodaOpenAiError(
      503,
      "No online Bob runner — start ooda-runner as user bob on hetzner-bob",
      "server_error",
    );
  }
  return pick;
}

function extractStdout(events: OodaOpenAiEvent[]): string {
  const stdout = [...events]
    .reverse()
    .find((event) => event.type === "stdout" && event.content.trim().length > 0);
  if (stdout) return stripFences(stdout.content);
  const chunks = events
    .filter((event) => event.type === "stdout_chunk")
    .map((event) => event.content)
    .join("");
  return stripFences(chunks);
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function unwrapThread(
  created: { id: string } | Array<{ id: string }>,
): { id: string } {
  const thread = Array.isArray(created) ? created[0] : created;
  if (!thread?.id) {
    throw new OodaOpenAiError(502, "threads.create returned no thread", "server_error");
  }
  return thread;
}

async function waitForSession(
  dispatch: OodaOpenAiDispatch,
  threadId: string,
  sessionId: string,
): Promise<void> {
  const now = dispatch.now ?? Date.now;
  const sleep =
    dispatch.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = now();
  const deadline = started + SESSION_TIMEOUT_MS;
  let sawRunning = false;

  while (now() < deadline) {
    const sessions = await dispatch.listSessions({ threadId });
    const session = sessions.find((row) => row.id === sessionId);
    if (!session) {
      throw new OodaOpenAiError(502, `session ${sessionId} disappeared`, "server_error");
    }
    if (session.status === "completed") return;
    if (session.status === "failed" || session.status === "cancelled") {
      throw new OodaOpenAiError(502, `Bob session ${session.status}`, "server_error");
    }
    if (session.status === "running") sawRunning = true;
    if (
      session.status === "pending" &&
      !sawRunning &&
      now() - started >= PENDING_CLAIM_MS
    ) {
      throw new OodaOpenAiError(
        503,
        "hetzner-bob runner did not claim the session",
        "server_error",
      );
    }
    await sleep(POLL_MS);
  }
  throw new OodaOpenAiError(504, "Bob session timed out", "server_error");
}

export async function completeOodaOpenAiChat(
  body: {
    model?: string;
    messages?: Array<{ role?: string; content?: unknown }>;
    stream?: boolean;
  },
  dispatch: OodaOpenAiDispatch,
): Promise<{
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}> {
  if (body.stream) {
    throw new OodaOpenAiError(400, "stream=true is not supported yet");
  }
  const prompt = toPrompt(body);
  const devices = await dispatch.listDevices();
  const runner = pickRunner(devices);
  const adapters = pickAdapters(body.model, runner);
  const slug = `openai-${crypto.randomUUID()}`;
  const thread = unwrapThread(
    await dispatch.createThread({
      title: "OpenAI chat completions",
      slug,
    }),
  );

  let lastError: unknown;
  for (const adapterId of adapters) {
    try {
      const session = await dispatch.sendPrompt({
        threadId: thread.id,
        runnerId: runner.id,
        adapterId,
        toolProfileId: TOOL_PROFILE,
        prompt,
      });
      await waitForSession(dispatch, thread.id, session.id);
      const events = await dispatch.getSessionEvents({ sessionId: session.id });
      const content = extractStdout(events);
      if (!content) {
        lastError = new Error(`${adapterId} returned empty output`);
        continue;
      }
      const model = body.model?.trim() || adapterId;
      return {
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor((dispatch.now ?? Date.now)() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
    } catch (error) {
      lastError = error;
      if (error instanceof OodaOpenAiError && error.status === 503) throw error;
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");
  throw new OodaOpenAiError(
    502,
    `Bob agent on ${PREFERRED_RUNNER} failed (${adapters.join(", ")}): ${detail}`,
    "server_error",
  );
}

export const OODA_OPENAI_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function oodaOpenAiOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: OODA_OPENAI_CORS_HEADERS });
}

export function withOodaOpenAiCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(OODA_OPENAI_CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function oodaOpenAiErrorResponse(error: unknown): Response {
  if (error instanceof OodaOpenAiError) {
    return Response.json(
      { error: { message: error.message, type: error.code } },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : "Bob generation failed";
  return Response.json(
    { error: { message, type: "server_error" } },
    { status: 502 },
  );
}
