import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { TRPCError } from "@trpc/server";
import {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "@gmacko/bob/contracts";

import { wrapHandler } from "../handlers/bridge";

import type { HandlerContext } from "../handlers/context";

const ctx: HandlerContext = {
  db: {} as HandlerContext["db"],
  userId: "test-user",
};

describe("wrapHandler", () => {
  it("resolves successful handler results", async () => {
    const handler = async (_ctx: HandlerContext, _input: unknown) => ({
      id: "1",
    });
    const result = await Effect.runPromise(wrapHandler(handler, ctx, {}));
    expect(result).toEqual({ id: "1" });
  });

  it("maps TRPCError NOT_FOUND to BobNotFoundError", async () => {
    const handler = async () => {
      throw new TRPCError({ code: "NOT_FOUND" });
    };
    const error = await Effect.runPromise(
      wrapHandler(handler, ctx, {}, "snapshot").pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(BobNotFoundError);
  });

  it("maps TRPCError FORBIDDEN to BobForbiddenError", async () => {
    const handler = async () => {
      throw new TRPCError({ code: "FORBIDDEN", message: "denied" });
    };
    const error = await Effect.runPromise(
      wrapHandler(handler, ctx, {}).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(BobForbiddenError);
  });

  it("maps TRPCError UNAUTHORIZED to BobForbiddenError", async () => {
    const handler = async () => {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "no session" });
    };
    const error = await Effect.runPromise(
      wrapHandler(handler, ctx, {}).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(BobForbiddenError);
  });

  it("maps TRPCError CONFLICT to BobConflictError", async () => {
    const handler = async () => {
      throw new TRPCError({ code: "CONFLICT", message: "version mismatch" });
    };
    const error = await Effect.runPromise(
      wrapHandler(handler, ctx, {}).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(BobConflictError);
  });

  it("maps unknown JS errors to BobConflictError", async () => {
    const handler = async () => {
      throw new Error("something broke");
    };
    const error = await Effect.runPromise(
      wrapHandler(handler, ctx, {}).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(BobConflictError);
  });
});
