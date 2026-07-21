/**
 * Effect-RPC handler functions for the cookies RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 3.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  cookiesImport,
  cookiesList,
  cookiesRemove,
  cookiesGetForSession,
  cookiesSetSessionScopes,
} from "../handlers/cookies.js";

export const makeCookiesRpcHandlers = (ctx: HandlerContext) => ({
  "cookies.import": ({
    payload,
  }: {
    payload: {
      cookies: {
        name: string;
        value: string;
        domain: string;
        path: string;
        expires?: number | null;
        secure: boolean;
        httpOnly: boolean;
        sameSite: "Strict" | "Lax" | "None";
      }[];
      source: "extension" | "cli";
    };
  }) => wrapHandler(cookiesImport, ctx, payload, "cookies"),

  "cookies.list": ({ payload }: { payload: void }) =>
    wrapHandler(
      (c: HandlerContext) => cookiesList(c),
      ctx,
      payload,
      "cookies",
    ),

  "cookies.remove": ({
    payload,
  }: {
    payload: { domain: string };
  }) => wrapHandler(cookiesRemove, ctx, payload, "cookies"),

  "cookies.getForSession": ({
    payload,
  }: {
    payload: { sessionId: string; domain: string };
  }) => wrapHandler(cookiesGetForSession, ctx, payload, "cookies"),

  "cookies.setSessionScopes": ({
    payload,
  }: {
    payload: { sessionId: string; domains: string[] };
  }) => wrapHandler(cookiesSetSessionScopes, ctx, payload, "cookies"),
});
