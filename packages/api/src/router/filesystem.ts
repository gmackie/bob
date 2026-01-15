import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

async function gatewayRequest(
  userId: string,
  endpoint: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(`${GATEWAY_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, ...body }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Gateway error: ${error}`,
    });
  }

  return response.json();
}

export const filesystemRouter = {
  list: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        showHidden: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await gatewayRequest(ctx.session.user.id, "/fs/list", {
        path: input.path,
        showHidden: input.showHidden,
      }) as {
        entries: Array<{
          name: string;
          path: string;
          isDirectory: boolean;
          isFile: boolean;
          size: number;
          modified: string;
        }>;
      };

      return result.entries;
    }),

  read: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await gatewayRequest(ctx.session.user.id, "/fs/read", {
        path: input.path,
        encoding: input.encoding,
      }) as { content: string; size: number };

      return result;
    }),

  write: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        content: z.string(),
        createDirs: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/fs/write", {
        path: input.path,
        content: input.content,
        createDirs: input.createDirs,
      });

      return { success: true };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/fs/delete", {
        path: input.path,
        recursive: input.recursive,
      });

      return { success: true };
    }),

  mkdir: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/fs/mkdir", {
        path: input.path,
        recursive: input.recursive,
      });

      return { success: true };
    }),

  move: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/fs/move", {
        source: input.source,
        destination: input.destination,
      });

      return { success: true };
    }),

  copy: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/fs/copy", {
        source: input.source,
        destination: input.destination,
      });

      return { success: true };
    }),

  search: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        pattern: z.string(),
        maxResults: z.number().min(1).max(1000).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await gatewayRequest(ctx.session.user.id, "/fs/search", {
        path: input.path,
        pattern: input.pattern,
        maxResults: input.maxResults,
      }) as { matches: string[] };

      return result.matches;
    }),
} satisfies TRPCRouterRecord;
