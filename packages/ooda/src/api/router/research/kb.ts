import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import {
  ClusterResponse,
  CompileKBResponse,
  EmbedResponse,
  EmbeddingStatsResponse,
  HealthResponse,
  KBSummary,
  ListKBsResponse,
} from "../../clients/sidecar-schemas";
import { authedProcedure, publicProcedure } from "../../trpc";
import { vaultScopedProcedure } from "../../middleware/vault-scope";
import {
  sidecarGet,
  sidecarGetValidated,
  sidecarPost,
  sidecarPostValidated,
} from "./_helpers";

export const kbRouter = {
  health: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/kb/health", tags: ["research.kb"] } })
    .output(z.any())
    .query(() => {
    return sidecarGetValidated("/api/health", HealthResponse);
  }),

  searchPapers: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/kb/search", tags: ["research.kb"] } })
    .input(z.object({ q: z.string(), page: z.number().optional() }))
    .output(z.any())
    .query(({ input }) => {
      const params = new URLSearchParams({ q: input.q });
      if (input.page !== undefined) {
        params.set("page", String(input.page));
      }
      return sidecarGet(`/api/search?${params.toString()}`);
    }),

  listKbs: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/kb", tags: ["research.kb"] } })
    .output(z.any())
    .query(() => {
    return sidecarGetValidated("/api/kb", ListKBsResponse);
  }),

  getKb: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/kb/get", tags: ["research.kb"] } })
    .input(z.object({ name: z.string() }))
    .output(z.any())
    .query(({ input }) => {
      return sidecarGetValidated(
        `/api/kb/${encodeURIComponent(input.name)}`,
        KBSummary,
      );
    }),

  compileKb: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/kb/compile", tags: ["research.kb"], protect: true } })
    .input(z.object({ name: z.string() }))
    .output(z.any())
    .mutation(({ input }) => {
      return sidecarPostValidated(
        `/api/kb/${encodeURIComponent(input.name)}/compile`,
        CompileKBResponse,
      );
    }),

  importChats: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/kb/import-chats", tags: ["research.kb"], protect: true } })
    .input(z.object({ data: z.unknown() }))
    .output(z.any())
    .mutation(({ input }) => {
      return sidecarPost("/api/chats/import", input.data);
    }),

  listSources: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/kb/sources", tags: ["research.kb"] } })
    .output(z.any())
    .query(({ ctx }) => {
    return ctx.db.select().from(ctx.vaultTables.sources);
  }),

  // --- Embedding + topic-clustering pipeline ---------------------------
  //
  // Fronts the Python sidecar's /api/embeddings/* routes. Reads are
  // `publicProcedure` (same posture as the rest of the read surface).
  // Writes that trigger side effects (runEmbedding, runClustering) ride
  // on `authedProcedure` — they can start long-running background
  // work that hits the local Ollama instance and rewrites the
  // embeddings / topics tables, so they require a valid session.

  embeddingStats: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/embeddings/stats", tags: ["research.embeddings"] } })
    .output(z.any())
    .query(() => {
    return sidecarGetValidated("/api/embeddings/stats", EmbeddingStatsResponse);
  }),

  runEmbedding: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/embeddings/embed", tags: ["research.embeddings"], protect: true } })
    .output(z.any())
    .mutation(() => {
    return sidecarPostValidated("/api/embeddings/embed", EmbedResponse);
  }),

  runClustering: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/embeddings/cluster", tags: ["research.embeddings"], protect: true } })
    .output(z.any())
    .mutation(() => {
    return sidecarPostValidated("/api/embeddings/cluster", ClusterResponse);
  }),

  listTopics: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/embeddings/topics", tags: ["research.embeddings"] } })
    .output(z.any())
    .query(() => {
    return sidecarGet("/api/embeddings/topics");
  }),

  getTopicSources: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/embeddings/topic-sources", tags: ["research.embeddings"] } })
    .input(z.object({ topicId: z.number() }))
    .output(z.any())
    .query(({ input }) => {
      return sidecarGet(`/api/embeddings/topics/${input.topicId}/sources`);
    }),
} satisfies RouterRecord;
