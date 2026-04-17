import type { Message } from "@gmacko/models";
import { MessageBubble } from "./message-bubble";

interface MessageListProps {
  messages: Message[];
  onFork?: (messageId: string) => void;
}

export function MessageList({ messages, onFork }: MessageListProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onFork={onFork} />
      ))}
    </div>
  );
}
