import type { Message } from "@gmacko/core/models";
import { cn } from "../utils";

interface MessageBubbleProps {
  message: Message;
  onFork?: (messageId: string) => void;
}

export function MessageBubble({ message, onFork }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      data-testid="message-bubble"
      data-role={message.role}
      className={cn(
        "group relative max-w-[80%] rounded-lg px-4 py-3 text-sm",
        isUser
          ? "ml-auto bg-primary text-primary-foreground"
          : "mr-auto bg-muted text-foreground",
      )}
    >
      {message.content}
      {!isUser && onFork && (
        <button
          data-testid="fork-button"
          onClick={() => onFork(message.id)}
          className="absolute -right-8 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          aria-label="Fork from this message"
          title="Fork from this message"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
            <path d="M12 12v3" />
          </svg>
        </button>
      )}
    </div>
  );
}
