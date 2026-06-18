export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  threadId: string;
  branchId: string;
  parentId: string | null;
  role: MessageRole;
  content: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface StreamingMessage extends Message {
  isStreaming: boolean;
  streamedContent: string;
}
