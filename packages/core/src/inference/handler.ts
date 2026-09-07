import { authorizeInferenceRequest } from "./auth";
import { completeViaRunner } from "./agent-client";
import { resolveAgentRoute } from "./agents";
import { readInferenceKeys } from "./env";
import { listModels } from "./models";
import { parseModelId } from "./parse-model";
import {
  completeChat,
  InferenceError,
  toChatCompletionResponse,
} from "./providers";
import type { ChatCompletionRequest, ChatMessage } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChatMessage[] = [];
  for (const row of raw) {
    const rec = asRecord(row);
    if (!rec || typeof rec.content !== "string") return null;
    const role = rec.role;
    if (role !== "system" && role !== "user" && role !== "assistant")
      return null;
    out.push({ role, content: rec.content });
  }
  return out.length > 0 ? out : null;
}

function parseRequest(
  body: unknown,
): ChatCompletionRequest | { error: string } {
  const rec = asRecord(body);
  if (!rec || typeof rec.model !== "string" || !rec.model.trim()) {
    return { error: "model is required" };
  }

  const messages = parseMessages(rec.messages);
  if (!messages) {
    return { error: "messages must be a non-empty array of {role, content}" };
  }

  const req: ChatCompletionRequest = {
    model: rec.model.trim(),
    messages,
  };

  if (typeof rec.temperature === "number") req.temperature = rec.temperature;
  if (typeof rec.max_tokens === "number") req.max_tokens = rec.max_tokens;
  if (typeof rec.stop === "string" || Array.isArray(rec.stop))
    req.stop = rec.stop as string | string[];
  if (rec.stream === true) req.stream = true;

  const responseFormat = asRecord(rec.response_format);
  if (
    responseFormat?.type === "json_object" ||
    responseFormat?.type === "text"
  ) {
    req.response_format = { type: responseFormat.type };
  }

  return req;
}

export async function handleChatCompletions(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<Response> {
  const auth = authorizeInferenceRequest(req, env);
  if (!auth.ok) {
    return Response.json(
      { error: { message: auth.message, type: "invalid_request_error" } },
      { status: auth.status },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        error: { message: "Invalid JSON body", type: "invalid_request_error" },
      },
      { status: 400 },
    );
  }

  const parsed = parseRequest(body);
  if ("error" in parsed) {
    return Response.json(
      { error: { message: parsed.error, type: "invalid_request_error" } },
      { status: 400 },
    );
  }

  const agentRoute = resolveAgentRoute(parsed.model);
  if (agentRoute) {
    if (parsed.stream) {
      return Response.json(
        {
          error: {
            message: "Streaming is not supported yet",
            type: "inference_error",
          },
        },
        { status: 501 },
      );
    }
    try {
      const response = await completeViaRunner(parsed, env);
      return Response.json(response);
    } catch (err) {
      if (err instanceof InferenceError) {
        return Response.json(
          { error: { message: err.message, type: "inference_error" } },
          { status: err.status },
        );
      }
      const message =
        err instanceof Error ? err.message : "Agent inference failed";
      return Response.json(
        { error: { message, type: "server_error" } },
        { status: 500 },
      );
    }
  }

  const spec = parseModelId(parsed.model);
  if (!spec) {
    return Response.json(
      {
        error: {
          message: `Unknown model: ${parsed.model}`,
          type: "invalid_request_error",
        },
      },
      { status: 400 },
    );
  }

  const keys = readInferenceKeys(env);

  try {
    const result = await completeChat(keys, spec, parsed);
    return Response.json(toChatCompletionResponse(parsed.model, result));
  } catch (err) {
    if (err instanceof InferenceError) {
      return Response.json(
        { error: { message: err.message, type: "inference_error" } },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : "Inference failed";
    return Response.json(
      { error: { message, type: "server_error" } },
      { status: 500 },
    );
  }
}

export function handleListModels(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): Response {
  const auth = authorizeInferenceRequest(req, env);
  if (!auth.ok) {
    return Response.json(
      { error: { message: auth.message, type: "invalid_request_error" } },
      { status: auth.status },
    );
  }

  return Response.json(listModels(env));
}

export function handleHealth(): Response {
  return Response.json({
    status: "healthy",
    inference: true,
    timestamp: new Date().toISOString(),
  });
}
