import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import {
  filesystemCopy,
  filesystemDelete,
  filesystemGitStatus,
  filesystemList,
  filesystemMkdir,
  filesystemMove,
  filesystemRead,
  filesystemSearch,
  filesystemWrite,
} from "../handlers/filesystem";
import { protectedProcedure } from "../trpc";

export const filesystemRouter = {
  list: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        showHidden: z.boolean().default(false),
      }),
    )
    .query(({ ctx, input }) =>
      filesystemList({ db: ctx.db, userId: ctx.session.user.id, filesystem: ctx.filesystem }, input),
    ),

  read: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
      }),
    )
    .query(({ ctx, input }) =>
      filesystemRead({ db: ctx.db, userId: ctx.session.user.id, filesystem: ctx.filesystem }, input),
    ),

  write: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        content: z.string(),
        createDirs: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      filesystemWrite({ db: ctx.db, userId: ctx.session.user.id, filesystem: ctx.filesystem }, input),
    ),

  delete: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) =>
      filesystemDelete({ db: ctx.db, userId: ctx.session.user.id, filesystem: ctx.filesystem }, input),
    ),

  mkdir: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        recursive: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      filesystemMkdir({ db: ctx.db, userId: ctx.session.user.id, filesystem: ctx.filesystem }, input),
    ),

  move: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      filesystemMove({ db: ctx.db, userId: ctx.session.user.id, filesystem: ctx.filesystem }, input),
    ),

  copy: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        destination: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      filesystemCopy({ db: ctx.db, userId: ctx.session.user.id, filesystem: ctx.filesystem }, input),
    ),

  search: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        pattern: z.string(),
        maxResults: z.number().min(1).max(1000).default(100),
      }),
    )
    .query(({ ctx, input }) =>
      filesystemSearch({ db: ctx.db, userId: ctx.session.user.id, filesystem: ctx.filesystem }, input),
    ),

  gitStatus: protectedProcedure
    .input(
      z.object({
        path: z.string(),
      }),
    )
    .query(({ ctx, input }) =>
      filesystemGitStatus({ db: ctx.db, userId: ctx.session.user.id, filesystem: ctx.filesystem }, input),
    ),
} satisfies TRPCRouterRecord;
