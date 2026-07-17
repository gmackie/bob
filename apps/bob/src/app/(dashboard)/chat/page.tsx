import { Suspense } from "react";

import { FullChatPage } from "./_components/full-chat-page";

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatPageFallback />}>
      <FullChatPage />
    </Suspense>
  );
}

function ChatPageFallback() {
  return (
    <div className="flex h-[calc(100vh-4rem)] items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">Loading chat...</p>
    </div>
  );
}
