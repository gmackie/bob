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
  health: publicProcedure.query(() => {
    return sidecarGetValidated("/api/health", HealthResponse);
  }),

  searchPapers: publicProcedure
    .input(z.object({ q: z.string(), page: z.number().optional() }))
    .query(({ input }) => {
      const params = new URLSearchParams({ q: input.q });
      if (input.page !== undefined) {
        params.set("page", String(input.page));
      }
      return sidecarGet(`/api/search?${params.toString()}`);
    }),

  listKbs: publicProcedure.query(() => {
    return sidecarGetValidated("/api/kb", ListKBsResponse);
  }),

  getKb: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => {
      return sidecarGetValidated(
        `/api/kb/${encodeURIComponent(input.name)}`,
        KBSummary,
      );
    }),

  compileKb: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(({ input }) => {
      return sidecarPostValidated(
        `/api/kb/${encodeURIComponent(input.name)}/compile`,
        CompileKBResponse,
      );
    }),

  importChats: publicProcedure
    .input(z.object({ data: z.unknown() }))
    .mutation(({ input }) => {
      return sidecarPost("/api/chats/import", input.data);
    }),

  listSources: vaultScopedProcedure.query(({ ctx }) => {
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

  embeddingStats: publicProcedure.query(() => {
    return sidecarGetValidated("/api/embeddings/stats", EmbeddingStatsResponse);
  }),

  runEmbedding: authedProcedure.mutation(() => {
    return sidecarPostValidated("/api/embeddings/embed", EmbedResponse);
  }),

  runClustering: authedProcedure.mutation(() => {
    return sidecarPostValidated("/api/embeddings/cluster", ClusterResponse);
  }),

  listTopics: publicProcedure.query(() => {
    return sidecarGet("/api/embeddings/topics");
  }),

  getTopicSources: publicProcedure
    .input(z.object({ topicId: z.number() }))
    .query(({ input }) => {
      return sidecarGet(`/api/embeddings/topics/${input.topicId}/sources`);
    }),
} satisfies RouterRecord;
