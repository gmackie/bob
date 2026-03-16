"use client";

import { ChatBubbleIcon } from "@radix-ui/react-icons";

import { Button } from "@bob/ui/button";

import { useChatPanel } from "./chat-panel-provider";

interface OpenChatPanelButtonProps {
  sessionId?: string;
  workItemId?: string;
  label?: string;
  children?: React.ReactNode;
}

export function OpenChatPanelButton({
  sessionId,
  workItemId,
  label,
  children,
}: OpenChatPanelButtonProps) {
  const { openPanel } = useChatPanel();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => openPanel({ sessionId, workItemId, label })}
    >
      <ChatBubbleIcon />
      {children ?? "Chat with Bob"}
    </Button>
  );
}
