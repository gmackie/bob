/**
 * Effect-RPC handler functions for the capture RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 2.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import { captureListTargets, captureCapture } from "../handlers/capture.js";

export const makeCaptureRpcHandlers = (ctx: HandlerContext) => ({
  "capture.listTargets": ({ payload }: { payload: void }) =>
    wrapHandler(captureListTargets, ctx, payload, "capture"),

  "capture.capture": ({
    payload,
  }: {
    payload: {
      targetType: "browser" | "window" | "screen";
      targetId?: string;
      url?: string;
    };
  }) => wrapHandler(captureCapture, ctx, payload, "capture"),
});
