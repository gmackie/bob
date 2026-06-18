import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";

import { mapTrpcError } from "@gmacko/bob/contracts";
import {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "@gmacko/bob/contracts";

describe("mapTrpcError", () => {
  it("maps NOT_FOUND to BobNotFoundError", () => {
    const result = mapTrpcError("NOT_FOUND", {
      entity: "workItem",
      id: "wi-123",
    });
    expect(result).toBeInstanceOf(BobNotFoundError);
    expect(result._tag).toBe("BobNotFoundError");
    expect(result.entity).toBe("workItem");
    expect(result.id).toBe("wi-123");
  });

  it("maps FORBIDDEN to BobForbiddenError", () => {
    const result = mapTrpcError("FORBIDDEN", { message: "no access" });
    expect(result).toBeInstanceOf(BobForbiddenError);
    expect(result._tag).toBe("BobForbiddenError");
    expect(result.message).toBe("no access");
  });

  it("maps UNAUTHORIZED to BobForbiddenError", () => {
    const result = mapTrpcError("UNAUTHORIZED", {
      message: "not authenticated",
    });
    expect(result).toBeInstanceOf(BobForbiddenError);
    expect(result._tag).toBe("BobForbiddenError");
    expect(result.message).toBe("not authenticated");
  });

  it("maps CONFLICT to BobConflictError", () => {
    const result = mapTrpcError("CONFLICT", { message: "duplicate slug" });
    expect(result).toBeInstanceOf(BobConflictError);
    expect(result._tag).toBe("BobConflictError");
    expect(result.message).toBe("duplicate slug");
  });

  it("maps unknown codes to BobConflictError with the code in message", () => {
    const result = mapTrpcError("INTERNAL_SERVER_ERROR", {
      message: "something broke",
    });
    expect(result).toBeInstanceOf(BobConflictError);
    expect(result._tag).toBe("BobConflictError");
    expect(result.message).toBe(
      "INTERNAL_SERVER_ERROR: something broke",
    );
  });

  it("maps BAD_REQUEST to BobConflictError with the code in message", () => {
    const result = mapTrpcError("BAD_REQUEST", { message: "invalid input" });
    expect(result).toBeInstanceOf(BobConflictError);
    expect(result._tag).toBe("BobConflictError");
    expect(result.message).toBe("BAD_REQUEST: invalid input");
  });

  it("returns errors usable in Effect.fail", async () => {
    const error = mapTrpcError("NOT_FOUND", {
      entity: "project",
      id: "p-1",
    });
    const program = Effect.fail(error);
    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
