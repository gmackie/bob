import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { conversationToSourceRecord } from "../to-source-record.js";
import type { ImportedConversation } from "../types.js";

const conv: ImportedConversation = {
  provider: "claude",
  conversationId: "abc-123",
  title: "Example chat",
  createdAt: "2026-01-01T00:00:00Z",
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello there" },
  ],
};

describe("conversationToSourceRecord", () => {
  it("builds externalId from provider and conversationId", () => {
    const rec = conversationToSourceRecord(conv);
    expect(rec.externalId).toBe("claude-abc-123");
  });

  it("sets kind to chat-import and carries metadata", () => {
    const rec = conversationToSourceRecord(conv);
    expect(rec.kind).toBe("chat-import");
    expect(rec.title).toBe("Example chat");
    expect(rec.author).toBe("claude");
    expect(rec.sourceTs).toBe("2026-01-01T00:00:00Z");
  });

  it("renders messages as markdown with role headings", () => {
    const rec = conversationToSourceRecord(conv);
    expect(rec.body).toBe(
      "### user\n\nhi\n\n### assistant\n\nhello there\n\n",
    );
  });

  it("hashes body with sha256", () => {
    const rec = conversationToSourceRecord(conv);
    const expected = createHash("sha256").update(rec.body).digest("hex");
    expect(rec.contentHash).toBe(expected);
    expect(rec.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("omits sourceTs when conversation has no createdAt", () => {
    const rec = conversationToSourceRecord({ ...conv, createdAt: undefined });
    expect(rec.sourceTs).toBeUndefined();
  });
});
