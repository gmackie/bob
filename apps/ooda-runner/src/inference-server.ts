import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  authorizeInferenceRequest,
  formatMessagesForAgent,
  resolveAgentRoute,
  resolveAgentModel,
  toChatCompletionResponse,
  type ChatCompletionRequest,
  type ChatMessage,
} from "@gmacko/core/inference";

import type { RunnerConfig } from "./config";
import { completeCodexInference } from "./inference-codex";
import type { RunnerServer } from "./runner-server";
import { completeGrok } from "./grok-runner";

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY_BYTES = 1024 * 1024;
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
    };
    const fail = (error: Error) => {
      cleanup();
      chunks.length = 0;
      req.resume();
      reject(error);
    };
    const onError = (error: Error) => fail(error);
    const onAborted = () => fail(new RequestError(400, "Request aborted"));
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new RequestError(413, "Request body exceeds 1 MiB"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new RequestError(400, "Invalid JSON body"));
      }
    };
    const timer = setTimeout(
      () => fail(new RequestError(408, "Request body timed out")),
      30_000,
    );
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES)
      fail(new RequestError(413, "Request body exceeds 1 MiB"));
  });
}

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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleChatCompletions(
  runner: RunnerServer,
  config: RunnerConfig,
  res: ServerResponse,
  body: unknown,
  signal: AbortSignal,
): Promise<void> {
  const parsed = parseRequest(body);
  if ("error" in parsed) {
    sendJson(res, 400, {
      error: { message: parsed.error, type: "invalid_request_error" },
    });
    return;
  }

  if (parsed.stream) {
    sendJson(res, 501, {
      error: {
        message: "Streaming is not supported yet",
        type: "inference_error",
      },
    });
    return;
  }

  const route = resolveAgentRoute(parsed.model);
  if (!route) {
    sendJson(res, 400, {
      error: {
        message: `Unsupported agent model: ${parsed.model}`,
        type: "invalid_request_error",
      },
    });
    return;
  }

  const { prompt, systemPrompt } = formatMessagesForAgent(
    parsed.messages,
    parsed,
  );

  try {
    if (route.adapterId === "grok") {
      const result = await completeGrok(route.model, parsed.messages, {
        json: parsed.response_format?.type === "json_object",
        maxTokens: parsed.max_tokens,
        temperature: parsed.temperature,
        signal,
      });
      sendJson(
        res,
        200,
        toChatCompletionResponse(parsed.model, { text: result.text }),
      );
      return;
    }

    if (route.adapterId === "codex") {
      const agentModel = resolveAgentModel(route);
      const text = await completeCodexInference({
        prompt,
        systemPrompt,
        model: agentModel,
        workspaceRoot: config.bobDevDir,
        signal,
      });
      sendJson(res, 200, toChatCompletionResponse(parsed.model, { text }));
      return;
    }

    const adapter = runner.getAdapter(route.adapterId);
    if (!adapter) {
      sendJson(res, 503, {
        error: {
          message: `Adapter ${route.adapterId} is not available on this runner`,
          type: "inference_error",
        },
      });
      return;
    }

    const agentModel = resolveAgentModel(route);
    const executor = runner.createExecutor(route.adapterId);
    const sessionId = `inf-${Date.now().toString(36)}`;
    const result = await executor.execute({
      threadSlug: "inference-gateway",
      threadTitle: "Inference Gateway",
      sessionId,
      prompt,
      toolProfileId: "default",
      systemPrompt,
      model: agentModel,
      signal,
      onEvent: () => {},
    });

    if (result.exitCode !== 0 && !result.agentResponse.trim()) {
      sendJson(res, 502, {
        error: {
          message: `Agent ${route.adapterId} exited with code ${result.exitCode}`,
          type: "inference_error",
        },
      });
      return;
    }

    sendJson(
      res,
      200,
      toChatCompletionResponse(parsed.model, { text: result.agentResponse }),
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Agent execution failed";
    sendJson(res, 500, {
      error: { message, type: "server_error" },
    });
  }
}

export function startInferenceServer(
  runner: RunnerServer,
  config: RunnerConfig,
): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    try {
      const url = req.url?.split("?")[0] ?? "/";

      if (req.method === "GET" && url === "/health") {
        sendJson(res, 200, {
          status: "healthy",
          inference: true,
          adapters: [...runner.listAdapterIds()],
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (req.method === "POST" && url === "/v1/chat/completions") {
        const authReq = new Request("http://runner/v1/chat/completions", {
          headers: {
            authorization: req.headers.authorization ?? "",
          },
        });
        const auth = authorizeInferenceRequest(authReq, process.env);
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: { message: auth.message, type: "invalid_request_error" },
          });
          return;
        }

        const body = await readJsonBody(req);
        const controller = new AbortController();
        const abort = () => controller.abort();
        res.once("close", abort);
        const timeout = setTimeout(abort, 120_000);
        try {
          await handleChatCompletions(
            runner,
            config,
            res,
            body,
            controller.signal,
          );
        } finally {
          clearTimeout(timeout);
          res.off("close", abort);
        }
        return;
      }

      sendJson(res, 404, {
        error: { message: "Not found", type: "invalid_request_error" },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      sendJson(res, err instanceof RequestError ? err.status : 500, {
        error: { message, type: "server_error" },
      });
    }
  });

  server.listen(config.port, config.inferenceHost || "127.0.0.1", () => {
    console.log(`[runner] inference HTTP listening on :${config.port}`);
  });

  return server;
}
