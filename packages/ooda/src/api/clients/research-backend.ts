/**
 * HTTP client for the Python research-backend sidecar.
 *
 * Lives here (packages/api) rather than in a shared package because it
 * is an internal adapter used only by the tRPC layer. Each method
 * mirrors one REST endpoint owned by
 * `packages/research-backend/src/research_backend/routes/dives.py`.
 *
 * Design notes
 * ------------
 * * snake_case bodies.  The Python side validates with pydantic using
 *   snake_case field names. We translate camelCase tRPC inputs to
 *   snake_case here at the boundary rather than forcing the whole JS
 *   layer into snake_case.
 * * Zod validates responses for `getDiveStatus` because the tRPC
 *   caller eventually exposes the row verbatim and we don't want a
 *   schema drift between Python and TS to surface as a runtime cast
 *   error deep in a React component. `getDiveResults` is validated by
 *   the tRPC output schema instead (its shape is richer and mostly
 *   pass-through).
 * * `null` on 404.  Callers convert to `TRPCError({code: "NOT_FOUND"})`
 *   at the router layer. Keeping the client 404-aware means we avoid
 *   inventing a new sentinel error type just for this case.
 */
import { z } from "zod";

export const DiveStatusSchema = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  seed: z.array(z.string()),
  budget_papers: z.number().int(),
  budget_seconds: z.number().int(),
  status: z.enum(["queued", "running", "done", "error"]),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  summary_md: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  errors_json: z
    .union([z.array(z.unknown()), z.record(z.string(), z.unknown())])
    .nullable(),
  error_md: z.string().nullable(),
});

export type DiveStatus = z.infer<typeof DiveStatusSchema>;

export interface SpawnDiveBody {
  thread_id: string;
  seeds: string[];
  budget_papers: number;
  budget_seconds: number;
  focus: "balanced" | "recent" | "foundational";
  vault_schema: "research_vault" | "personal_vault";
}

export interface SpawnDiveResponse {
  exploration_id: string;
  status: "queued";
}

export interface DiveResults {
  exploration_id: string;
  status: string;
  summary_md: string | null;
  papers: Record<string, unknown>[];
  clusters: Record<string, unknown>[];
  edge_counts_by_kind: Record<string, number>;
}

export class ResearchBackendClient {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    // Trim a trailing slash on baseUrl so `${baseUrl}/dives` works whether
    // the env var includes one or not.
    const base = this.baseUrl.replace(/\/+$/, "");
    return `${base}${path}`;
  }

  async spawnDive(body: SpawnDiveBody): Promise<SpawnDiveResponse> {
    const res = await fetch(this.url("/dives"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `spawn dive failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as SpawnDiveResponse;
  }

  async getDiveStatus(id: string): Promise<DiveStatus | null> {
    const res = await fetch(this.url(`/dives/${id}`));
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `get dive failed: ${res.status} ${await res.text()}`,
      );
    }
    return DiveStatusSchema.parse(await res.json());
  }

  async getDiveResults(
    id: string,
    topK = 10,
  ): Promise<DiveResults | null> {
    const res = await fetch(
      this.url(`/dives/${id}/results?top_k=${topK}`),
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `get dive results failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as DiveResults;
  }
}
