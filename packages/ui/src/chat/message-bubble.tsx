import type { Message } from "@gmacko/models";
import { cn } from "../utils";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      data-testid="message-bubble"
      data-role={message.role}
      className={cn(
        "max-w-[80%] rounded-lg px-4 py-3 text-sm",
        isUser
          ? "ml-auto bg-[var(--color-accent)] text-[var(--color-bg)]"
          : "mr-auto bg-[var(--color-bg-tertiary)] text-[var(--color-text)]",
      )}
    >
      {message.content}
    </div>
  );
}
