/**
 * Bridge utilities for mapping tRPC error codes to Bob's tagged Effect errors.
 *
 * Used by handler wrappers that extract business logic from tRPC procedures
 * and need to convert thrown TRPCError instances into typed Effect failures.
 */

import { BobNotFoundError, BobForbiddenError, BobConflictError } from "./errors.js";

/** tRPC error codes that map to Bob's tagged errors. */
export type TrpcErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | (string & {});

/** Context for NOT_FOUND errors — requires entity and id. */
export interface NotFoundContext {
  readonly entity: string;
  readonly id: string;
}

/** Context for all other errors — requires a message. */
export interface MessageContext {
  readonly message: string;
}

/**
 * Maps a tRPC error code to a Bob tagged error.
 *
 * - `NOT_FOUND` → `BobNotFoundError`
 * - `FORBIDDEN` / `UNAUTHORIZED` → `BobForbiddenError`
 * - `CONFLICT` → `BobConflictError`
 * - Anything else → `BobConflictError` with the code prefixed in the message
 */
export function mapTrpcError(
  code: "NOT_FOUND",
  ctx: NotFoundContext,
): BobNotFoundError;
export function mapTrpcError(
  code: "FORBIDDEN" | "UNAUTHORIZED",
  ctx: MessageContext,
): BobForbiddenError;
export function mapTrpcError(
  code: "CONFLICT",
  ctx: MessageContext,
): BobConflictError;
export function mapTrpcError(
  code: string,
  ctx: MessageContext,
): BobConflictError;
export function mapTrpcError(
  code: string,
  ctx: NotFoundContext | MessageContext,
): BobNotFoundError | BobForbiddenError | BobConflictError {
  switch (code) {
    case "NOT_FOUND":
      return new BobNotFoundError(ctx as NotFoundContext);
    case "FORBIDDEN":
    case "UNAUTHORIZED":
      return new BobForbiddenError(ctx as MessageContext);
    case "CONFLICT":
      return new BobConflictError(ctx as MessageContext);
    default:
      return new BobConflictError({
        message: `${code}: ${(ctx as MessageContext).message}`,
      });
  }
}
