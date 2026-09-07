import { describe, expect, it } from "vitest";

import {
  resolveAgentRoute,
  formatMessagesForAgent,
  resolveAgentModel,
} from "../agents";
import { authorizeInferenceRequest } from "../auth";
import { hasKeyFor, readInferenceKeys } from "../env";
import { handleHealth, handleListModels } from "../handler";
import { listModels } from "../models";
import { parseModelId } from "../parse-model";

describe("parseModelId", () => {
  it("parses provider/model ids", () => {
    expect(parseModelId("openai/gpt-4o-mini")).toEqual({
      api: "openai",
      model: "gpt-4o-mini",
    });
    expect(parseModelId("anthropic/claude-sonnet-4-5")).toEqual({
      api: "anthropic",
      model: "claude-sonnet-4-5",
    });
  });

  it("defaults bare model names to openai", () => {
    expect(parseModelId("gpt-4o-mini")).toEqual({
      api: "openai",
      model: "gpt-4o-mini",
    });
  });
});

describe("resolveAgentRoute", () => {
  it("maps provider prefixes to runner adapters", () => {
    expect(resolveAgentRoute("claude/claude-sonnet-4-5")).toEqual({
      provider: "claude",
      adapterId: "claude",
      model: "claude-sonnet-4-5",
      rawModel: "claude/claude-sonnet-4-5",
    });
    expect(resolveAgentRoute("openai/gpt-4o-mini")).toEqual({
      provider: "codex",
      adapterId: "codex",
      model: "gpt-4o-mini",
      rawModel: "openai/gpt-4o-mini",
    });
    expect(resolveAgentModel(resolveAgentRoute("openai/gpt-4o-mini")!)).toBe(
      "5.6-luna",
    );
    expect(resolveAgentModel(resolveAgentRoute("codex/5.6-luna")!)).toBe(
      "5.6-luna",
    );
    expect(resolveAgentRoute("cursor/default")?.adapterId).toBe("cursor-agent");
    expect(resolveAgentRoute("grok/grok-3")?.adapterId).toBe("grok");
  });

  it("returns null for direct LLM providers without agent routing", () => {
    expect(resolveAgentRoute("google/gemini-2.5-flash")).toBeNull();
  });
});

describe("formatMessagesForAgent", () => {
  it("combines roles into a prompt and system string", () => {
    const formatted = formatMessagesForAgent(
      [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
      {},
    );
    expect(formatted.systemPrompt).toBe("You are helpful.");
    expect(formatted.prompt).toContain("user: Hello");
  });
});

describe("authorizeInferenceRequest", () => {
  it("refuses requests when BOB_API_KEY is unset", () => {
    const req = new Request("http://localhost/v1/chat/completions");
    expect(authorizeInferenceRequest(req, {})).toEqual({
      ok: false,
      status: 503,
      message: "Inference authentication is not configured",
    });
  });

  it("requires bearer token when BOB_API_KEY is set", () => {
    const req = new Request("http://localhost/v1/chat/completions");
    const env = { BOB_API_KEY: "secret" };
    expect(authorizeInferenceRequest(req, env)).toEqual({
      ok: false,
      status: 401,
      message: "Missing Authorization: Bearer token",
    });

    const authed = new Request("http://localhost/v1/chat/completions", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(authorizeInferenceRequest(authed, env)).toEqual({ ok: true });
  });
});

describe("listModels", () => {
  it("includes agent models when runner URL is configured", () => {
    const body = listModels({ OODA_RUNNER_URL: "http://127.0.0.1:3010" });
    expect(body.data.some((m) => m.id === "openai/5.6-luna")).toBe(true);
    expect(body.data.some((m) => m.id === "claude/claude-sonnet-4-5")).toBe(
      true,
    );
  });

  it("returns direct LLM models for configured providers", () => {
    const body = listModels({ OPENAI_API_KEY: "sk-test" });
    expect(body.object).toBe("list");
    expect(body.data.some((m) => m.id === "openai/gpt-4o-mini")).toBe(true);
    expect(body.data.some((m) => m.id === "anthropic/claude-sonnet-4-5")).toBe(
      false,
    );
  });

  it("returns all known models when openrouter is configured", () => {
    const body = listModels({ OPENROUTER_API_KEY: "sk-or-test" });
    expect(body.data.length).toBeGreaterThan(10);
  });
});

describe("hasKeyFor", () => {
  it("falls back to openrouter for most providers", () => {
    const keys = readInferenceKeys({ OPENROUTER_API_KEY: "sk-or" });
    expect(hasKeyFor(keys, "anthropic")).toBe(true);
    expect(hasKeyFor(keys, "google")).toBe(true);
    expect(hasKeyFor(keys, "openai")).toBe(true);
  });
});

describe("handlers", () => {
  it("health responds ok", () => {
    const res = handleHealth();
    expect(res.status).toBe(200);
  });

  it("models route responds with list", () => {
    const req = new Request("http://localhost/v1/models", {
      headers: { Authorization: "Bearer test-key" },
    });
    const res = handleListModels(req, {
      OPENAI_API_KEY: "sk-test",
      BOB_API_KEY: "test-key",
    });
    expect(res.status).toBe(200);
  });
});
