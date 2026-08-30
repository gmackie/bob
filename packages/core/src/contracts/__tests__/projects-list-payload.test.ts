/**
 * `projects.list` declared `payload: Schema.Void` while its handler reads
 * `payload.workspaceId` — and uses it for the access check
 * (`assertWorkspaceAccess`) before querying. Calling it therefore crashed with
 * "Cannot read properties of undefined (reading 'workspaceId')".
 *
 * That crash was invisible until 2026-08-30: the bridge mapped it to an
 * undeclared tagged error, which the Rpc's error channel could not encode, so
 * the client saw only "Expected UnauthorizedError | TenantNotSelectedError".
 * The workspaces list was simply blank.
 */
import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { ProjectsListRpc } from "../groups/projects.js";

describe("ProjectsListRpc payload", () => {
  it("requires a workspaceId, because the handler scopes access by it", () => {
    const decode = Schema.decodeUnknownSync(ProjectsListRpc.payloadSchema as never);

    expect(() => decode({ workspaceId: "9523c800-d2f5-4336-a6d3-ac2305f2b0a5" })).not.toThrow();
  });

  it("rejects an empty payload rather than reaching the handler with undefined", () => {
    const decode = Schema.decodeUnknownSync(ProjectsListRpc.payloadSchema as never);

    expect(() => decode(undefined)).toThrow();
    expect(() => decode({})).toThrow();
  });
});
