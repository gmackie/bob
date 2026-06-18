import { describe, expect, it } from "vitest";

import { createProvenanceRecord } from "../create-provenance-record";

describe("createProvenanceRecord", () => {
  it("creates a record for a source-derived artifact", () => {
    const record = createProvenanceRecord({
      artifactId: "sha256:abc123",
      threadId: "thread_sleep",
      sessionId: "session_1",
      capabilityId: "reddit",
      operationId: "search",
      sourceType: "api",
      queryOrInputRef: "best blackout curtains reddit",
      canonicalSourceRef: "https://reddit.com/r/sleep/123",
    });

    expect(record.id).toBeDefined();
    expect(record.artifactId).toBe("sha256:abc123");
    expect(record.capabilityId).toBe("reddit");
    expect(record.sourceType).toBe("api");
    expect(record.retrievedAt).toBeDefined();
    expect(record.canonicalSourceRef).toBe("https://reddit.com/r/sleep/123");
  });

  it("creates a record without canonical source ref", () => {
    const record = createProvenanceRecord({
      artifactId: "sha256:def456",
      threadId: "thread_1",
      sessionId: "session_1",
      capabilityId: "codex",
      operationId: "generate",
      sourceType: "agent",
      queryOrInputRef: "analyze sleep data",
    });

    expect(record.canonicalSourceRef).toBeUndefined();
    expect(record.sourceType).toBe("agent");
  });

  it("marks unverified when flagged", () => {
    const record = createProvenanceRecord({
      artifactId: "sha256:ghi789",
      threadId: "thread_1",
      sessionId: "session_1",
      capabilityId: "reddit",
      operationId: "search",
      sourceType: "api",
      queryOrInputRef: "test query",
      unverified: true,
    });

    expect(record.unverified).toBe(true);
  });
});
