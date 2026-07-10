import { describe, expect, it } from "vitest";

import {
  encodeClientMessage,
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
} from "../protocol.js";

describe("WS protocol collaboration messages (BOB-14)", () => {
  it("round-trips presence_update client messages", () => {
    const encoded = encodeClientMessage({
      type: "presence_update",
      sessionId: "11111111-1111-4111-8111-111111111111",
      focus: "artifact",
      cursor: 12,
      displayName: "Alex",
    });
    const parsed = parseClientMessage(encoded);
    expect(parsed).toEqual({
      type: "presence_update",
      sessionId: "11111111-1111-4111-8111-111111111111",
      focus: "artifact",
      cursor: 12,
      displayName: "Alex",
    });
  });

  it("round-trips collab_chat client messages", () => {
    const encoded = encodeClientMessage({
      type: "collab_chat",
      sessionId: "11111111-1111-4111-8111-111111111111",
      clientMessageId: "c1",
      body: "Ship it",
      displayName: "Alex",
    });
    expect(parseClientMessage(encoded)?.type).toBe("collab_chat");
  });

  it("round-trips presence_snapshot and collab_chat_message server messages", () => {
    const snapshot = encodeServerMessage({
      type: "presence_snapshot",
      sessionId: "s1",
      participants: [
        {
          userId: "u1",
          clientId: "c1",
          displayName: "Alex",
          joinedAt: "2026-07-01T00:00:00.000Z",
          lastSeenAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    expect(parseServerMessage(snapshot)?.type).toBe("presence_snapshot");

    const chat = encodeServerMessage({
      type: "collab_chat_message",
      sessionId: "s1",
      message: {
        userId: "u1",
        displayName: "Alex",
        body: "hi",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    });
    expect(parseServerMessage(chat)?.type).toBe("collab_chat_message");

    const artifact = encodeServerMessage({
      type: "artifact_updated",
      sessionId: "s1",
      artifactId: "a1",
      workItemId: "w1",
      contentVersion: 2,
      lastEditedByUserId: "u1",
      action: "updated",
      content: "new body",
    });
    expect(parseServerMessage(artifact)?.type).toBe("artifact_updated");
  });
});
