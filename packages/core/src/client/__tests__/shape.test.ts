// Phase 6F Task 8 — shape tests for the per-group client facades.
//
// These tests do NOT hit a real HTTP server — Task 9 does the end-to-end
// stub-server round-trip. Here we verify the *surface* of each facade:
//   - method names match the expected procedure list,
//   - Promise-returning methods expose the right identifier,
//   - `agent.sendTurn` exposes an AsyncIterable (not a Promise).
//
// A dummy runtime rejects every effect and returns an empty async iterable
// for streams — the tests never invoke it to completion, just inspect the
// returned shape.

import { describe, expect, it } from "vitest";

import {
  makeAgentClient,
  makeAuthClient,
  makeProjectsClient,
  makeSecretsClient,
} from "@gmacko/core/client";
import type { ClientRuntime } from "../internal/runtime.js";

const dummyRuntime: ClientRuntime = {
  runEffect: () =>
    Promise.reject(new Error("shape-test dummy runtime: not wired")),
  runStream: () => {
    const iter: AsyncIterable<never> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(
              new Error("shape-test dummy runtime: not wired"),
            );
          },
        };
      },
    };
    return iter;
  },
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>;

describe("makeAuthClient shape", () => {
  it("exposes 9 Promise-returning methods matching AuthRpc procedures", () => {
    const client = makeAuthClient(dummyRuntime);
    const methods = [
      "whoAmI",
      "listMemberships",
      "resolveTenant",
      "issueApiKey",
      "listApiKeys",
      "revokeApiKey",
      "startDeviceFlow",
      "pollDeviceCode",
      "approveDeviceCode",
    ] as const;
    for (const name of methods) {
      expect(typeof asRecord(client)[name]).toBe("function");
    }
    expect(Object.keys(client).sort()).toEqual([...methods].sort());
  });
});

describe("makeProjectsClient shape", () => {
  it("exposes 4 Promise-returning methods matching ProjectsRpc procedures", () => {
    const client = makeProjectsClient(dummyRuntime);
    const methods = ["create", "list", "getBySlug", "delete"] as const;
    for (const name of methods) {
      expect(typeof asRecord(client)[name]).toBe("function");
    }
    expect(Object.keys(client).sort()).toEqual([...methods].sort());
  });
});

describe("makeSecretsClient shape", () => {
  it("exposes 6 Promise-returning methods matching SecretsRpc procedures", () => {
    const client = makeSecretsClient(dummyRuntime);
    const methods = [
      "create",
      "list",
      "getEnvelope",
      "decryptForUse",
      "markUsed",
      "delete",
    ] as const;
    for (const name of methods) {
      expect(typeof asRecord(client)[name]).toBe("function");
    }
    expect(Object.keys(client).sort()).toEqual([...methods].sort());
  });
});

describe("makeAgentClient shape", () => {
  it("exposes 5 methods; sendTurn returns AsyncIterable, others return Promise", () => {
    const client = makeAgentClient(dummyRuntime);
    const methods = [
      "createSession",
      "sendTurn",
      "cancelSession",
      "closeSession",
      "getTranscript",
    ] as const;
    for (const name of methods) {
      expect(typeof asRecord(client)[name]).toBe("function");
    }
    expect(Object.keys(client).sort()).toEqual([...methods].sort());

    const streamResult = client.sendTurn({
      conversationId: "stub",
      prompt: "hello",
    });
    expect(typeof streamResult[Symbol.asyncIterator]).toBe("function");
  });
});
