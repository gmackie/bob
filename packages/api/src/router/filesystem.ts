import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

// Filesystem operations previously proxied to the old monolithic gateway
// which has been removed. These operations now run on the Go daemon.
// TODO: Add an HTTP file API to the Go daemon so tRPC can proxy to it,
// or stream file data over the WS connection.

const NOT_IMPLEMENTED_MSG =
  "Filesystem operations are not available. The Go daemon now owns file access.";

export const filesystemRouter = {
  list: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        showHidden: z.boolean().default(false),
      })
    )
    .query(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
    }),

  read: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
      })
    )
    .query(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
    }),

  write: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        content: z.string(),
        createDirs: z.boolean().default(true),
      })
    )
    .mutation(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
    }),

  delete: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(false),
      })
    )
    .mutation(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
    }),

  mkdir: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(true),
      })
    )
    .mutation(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
    }),

  move: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      })
    )
    .mutation(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
    }),

  copy: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      })
    )
    .mutation(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
    }),

  search: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        pattern: z.string(),
        maxResults: z.number().min(1).max(1000).default(100),
      })
    )
    .query(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
    }),

  gitStatus: protectedProcedure
    .input(
      z.object({
        path: z.string(),
      })
    )
    .query(async () => {
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
    }),
} satisfies TRPCRouterRecord;
