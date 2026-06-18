/**
 * Filesystem handler functions — pure business logic extracted from the tRPC
 * filesystem router.
 *
 * All operations are NOT_IMPLEMENTED — the Go daemon now owns file access.
 *
 * Phase 7B-4D-beta Task 6.
 */
import { TRPCError } from "@trpc/server";

// Filesystem operations previously proxied to the old monolithic gateway
// which has been removed. These operations now run on the Go daemon.
// TODO: Add an HTTP file API to the Go daemon so tRPC can proxy to it,
// or stream file data over the WS connection.

const NOT_IMPLEMENTED_MSG =
  "Filesystem operations are not available. The Go daemon now owns file access.";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function filesystemList(): Promise<never> {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
}

export async function filesystemRead(): Promise<never> {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
}

export async function filesystemWrite(): Promise<never> {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
}

export async function filesystemDelete(): Promise<never> {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
}

export async function filesystemMkdir(): Promise<never> {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
}

export async function filesystemMove(): Promise<never> {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
}

export async function filesystemCopy(): Promise<never> {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
}

export async function filesystemSearch(): Promise<never> {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
}

export async function filesystemGitStatus(): Promise<never> {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: NOT_IMPLEMENTED_MSG });
}
