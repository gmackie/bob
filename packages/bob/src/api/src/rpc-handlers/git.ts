/**
 * Effect-RPC handler functions for the git RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 4.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  gitPushAndCreatePr,
  gitJjIsRepo,
  gitJjLog,
  gitJjNew,
  gitJjDescribe,
  gitJjSquash,
  gitJjDiff,
} from "../handlers/git.js";

export const makeGitRpcHandlers = (ctx: HandlerContext) => ({
  "git.pushAndCreatePr": ({
    payload,
  }: {
    payload: {
      repositoryId: string;
      path: string;
      sessionId?: string;
      title: string;
      body?: string;
      headBranch: string;
      baseBranch?: string;
      draft: boolean;
      planningTaskId?: string;
    };
  }) => wrapHandler(gitPushAndCreatePr, ctx, payload, "git"),

  "git.jjIsRepo": ({
    payload,
  }: {
    payload: { path: string };
  }) => wrapHandler(gitJjIsRepo, ctx, payload, "git"),

  "git.jjLog": ({
    payload,
  }: {
    payload: { path: string; limit: number };
  }) => wrapHandler(gitJjLog, ctx, payload, "git"),

  "git.jjNew": ({
    payload,
  }: {
    payload: { path: string; description?: string };
  }) => wrapHandler(gitJjNew, ctx, payload, "git"),

  "git.jjDescribe": ({
    payload,
  }: {
    payload: { path: string; description: string; revision?: string };
  }) => wrapHandler(gitJjDescribe, ctx, payload, "git"),

  "git.jjSquash": ({
    payload,
  }: {
    payload: { path: string };
  }) => wrapHandler(gitJjSquash, ctx, payload, "git"),

  "git.jjDiff": ({
    payload,
  }: {
    payload: { path: string; revision?: string };
  }) => wrapHandler(gitJjDiff, ctx, payload, "git"),
});
