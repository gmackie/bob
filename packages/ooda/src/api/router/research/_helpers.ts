import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { ResearchBackendClient } from "../../clients/research-backend";

// Dashboard-facing caps documented in Task 4.2: we pull at most this many
// graph nodes/edges per thread in a single request. The dashboard expects
// these bounds for layout stability; agents querying the graph should use
// more targeted (BFS-style) queries instead.
export const GRAPH_NODE_LIMIT = 500;
export const GRAPH_EDGE_LIMIT = 2000;

export function getResearchApiUrl(): string {
  const url = process.env.RESEARCH_API_URL;
  if (!url || url.trim() === "") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Research backend not configured. Set RESEARCH_API_URL in .env. See docs/SETUP.md#research-backend.",
    });
  }
  return url;
}

export async function sidecarGet<T>(path: string): Promise<T> {
  const base = getResearchApiUrl();
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Research sidecar returned ${res.status}: ${res.statusText}`,
    });
  }
  return res.json() as Promise<T>;
}

export async function sidecarPost<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const base = getResearchApiUrl();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Research sidecar returned ${res.status}: ${res.statusText}`,
    });
  }
  return res.json() as Promise<T>;
}

/**
 * Like `sidecarGet`, but validates the response against a Zod schema.
 * Throws a `ZodError` if the sidecar JSON doesn't match the declared
 * shape — surfacing Python↔TypeScript drift before it reaches callers.
 */
export async function sidecarGetValidated<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const raw = await sidecarGet<unknown>(path);
  return schema.parse(raw);
}

/**
 * Like `sidecarPost`, but validates the response against a Zod schema.
 */
export async function sidecarPostValidated<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const raw = await sidecarPost<unknown>(path, body);
  return schema.parse(raw);
}

export function getBackendClient(): ResearchBackendClient {
  return new ResearchBackendClient(getResearchApiUrl());
}

export const DiveSpawnInput = z.object({
  threadId: z.string().uuid(),
  seeds: z.array(z.string()).min(1).max(20),
  budgetPapers: z.number().int().min(5).max(300).default(60),
  budgetSeconds: z.number().int().min(30).max(900).default(180),
  focus: z
    .enum(["balanced", "recent", "foundational"])
    .default("balanced"),
});
