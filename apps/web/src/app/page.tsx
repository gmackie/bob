"use client";

import { useState } from "react";
import { Shell, Sidebar, MessageList, Composer, BranchTree } from "@gmacko/ui";
import type { Message, BranchTree as BranchTreeModel } from "@gmacko/models";

const initialBranch: BranchTreeModel = {
  branch: {
    id: "main",
    threadId: "t1",
    parentBranchId: null,
    forkPointMessageId: null,
    name: "Main thread",
    createdAt: new Date(),
  },
  messageCount: 0,
  children: [],
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeBranchId, setActiveBranchId] = useState("main");

  const handleSend = (content: string) => {
    const msg: Message = {
      id: crypto.randomUUID(),
      threadId: "t1",
      branchId: activeBranchId,
      parentId: messages.at(-1)?.id ?? null,
      role: "user",
      content,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, msg]);
  };

  return (
    <Shell
      sidebar={
        <Sidebar>
          <div className="p-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Branches
          </div>
          <BranchTree
            tree={initialBranch}
            activeBranchId={activeBranchId}
            onSelect={setActiveBranchId}
          />
        </Sidebar>
      }
    >
      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <MessageList messages={messages} />
        </div>
        <Composer onSend={handleSend} />
      </div>
    </Shell>
  );
}
