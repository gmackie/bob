import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  filesystemList,
  filesystemRead,
  filesystemWrite,
  filesystemDelete,
  filesystemMkdir,
  filesystemMove,
  filesystemCopy,
  filesystemSearch,
  filesystemGitStatus,
} from "../handlers/filesystem";

export const filesystemRouter = {
  list: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        showHidden: z.boolean().default(false),
      }),
    )
    .query(() => filesystemList()),

  read: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
      }),
    )
    .query(() => filesystemRead()),

  write: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        content: z.string(),
        createDirs: z.boolean().default(true),
      }),
    )
    .mutation(() => filesystemWrite()),

  delete: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(false),
      }),
    )
    .mutation(() => filesystemDelete()),

  mkdir: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(true),
      }),
    )
    .mutation(() => filesystemMkdir()),

  move: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      }),
    )
    .mutation(() => filesystemMove()),

  copy: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      }),
    )
    .mutation(() => filesystemCopy()),

  search: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        pattern: z.string(),
        maxResults: z.number().min(1).max(1000).default(100),
      }),
    )
    .query(() => filesystemSearch()),

  gitStatus: protectedProcedure
    .input(
      z.object({
        path: z.string(),
      }),
    )
    .query(() => filesystemGitStatus()),
} satisfies TRPCRouterRecord;
