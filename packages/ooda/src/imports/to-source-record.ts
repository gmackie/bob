import { createHash } from "node:crypto";

import type { ImportedConversation } from "./types";

export interface ImportedSourceRecord {
  kind: "chat-import";
  externalId: string;
  title: string;
  body: string;
  contentHash: string;
  author?: string;
  sourceTs?: string;
}

/**
 * Convert an `ImportedConversation` into a vault-ready source record,
 * rendering messages as markdown and hashing the body with sha256.
 */
export function conversationToSourceRecord(
  conv: ImportedConversation,
): ImportedSourceRecord {
  const body = conv.messages
    .map((m) => `### ${m.role}\n\n${m.content}\n\n`)
    .join("");

  const contentHash = createHash("sha256").update(body).digest("hex");

  return {
    kind: "chat-import",
    externalId: `${conv.provider}-${conv.conversationId}`,
    title: conv.title,
    body,
    contentHash,
    author: conv.provider,
    sourceTs: conv.createdAt,
  };
}
