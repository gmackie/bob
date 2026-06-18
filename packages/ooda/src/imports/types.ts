export interface ImportedMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  model?: string;
}

export interface ImportedConversation {
  provider: string;
  conversationId: string;
  title: string;
  messages: ImportedMessage[];
  createdAt?: string;
  updatedAt?: string;
}

export type ImportFormat = "claude" | "chatgpt" | "ooda-native";
