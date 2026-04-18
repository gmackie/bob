"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Shell, Sidebar, MessageList, Composer, BranchTree } from "@gmacko/ui";
import type { Message, BranchTree as BranchTreeModel } from "@gmacko/models";
import {
  useThreadsList,
  useCreateThread,
  useBranchesByThread,
  useMessagesByBranch,
  useAgentChat,
} from "@/rpc/hooks";

/* ------------------------------------------------------------------ */
/* Fallback data for when the DB is unavailable                       */
/* ------------------------------------------------------------------ */

const fallbackBranch: BranchTreeModel = {
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

/* ------------------------------------------------------------------ */
/* Page component                                                     */
/* ------------------------------------------------------------------ */

export default function Home() {
  const queryClient = useQueryClient();

  // --- Local fallback state (used when API is unreachable) ----------
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeBranchId, setActiveBranchId] = useState("main");

  // --- RPC queries --------------------------------------------------
  const threadsQuery = useThreadsList();

  const threads = threadsQuery.data ?? [];
  const activeThreadId = selectedThreadId ?? threads[0]?.id;

  const branchesQuery = useBranchesByThread(activeThreadId ?? undefined);

  const messagesQuery = useMessagesByBranch(
    activeThreadId ?? undefined,
    activeBranchId,
    !!activeThreadId && activeBranchId !== "main",
  );

  // --- RPC mutations ------------------------------------------------
  const createThread = useCreateThread();

  const agentChat = useAgentChat();

  // --- Derived state -------------------------------------------------
  const apiAvailable = !threadsQuery.isError;
  const apiMessages = messagesQuery.data ?? [];
  // Merge API messages with optimistic local messages (dedup by id)
  const apiMessageIds = new Set(apiMessages.map((m) => m.id));
  const pendingLocal = localMessages.filter((m) => !apiMessageIds.has(m.id));
  const messages = apiAvailable
    ? [...apiMessages, ...pendingLocal]
    : localMessages;

  const branches = branchesQuery.data ?? [];

  // Build branch tree from flat list, or fall back
  const branchTree: BranchTreeModel =
    branches.length > 0
      ? {
          branch: branches[0]!,
          messageCount: 0,
          children: branches.slice(1).map((b) => ({
            branch: b,
            messageCount: 0,
            children: [],
          })),
        }
      : fallbackBranch;

  // --- Handlers ------------------------------------------------------
  const handleSend = (content: string) => {
    if (apiAvailable && activeThreadId && activeBranchId !== "main") {
      // Optimistically add user message to the list
      const optimisticMsg: Message = {
        id: crypto.randomUUID(),
        threadId: activeThreadId,
        branchId: activeBranchId,
        parentId: (messages as Message[]).at(-1)?.id ?? null,
        role: "user",
        content,
        createdAt: new Date(),
      };
      setLocalMessages((prev) => [...prev, optimisticMsg]);

      agentChat.mutate(
        {
          threadId: activeThreadId,
          branchId: activeBranchId,
          content,
        },
        {
          onSuccess: () => {
            setLocalMessages([]);
            queryClient.invalidateQueries({
              queryKey: ["messages", "listByBranch"],
            });
          },
        },
      );
    } else {
      // Fallback: local state
      const msg: Message = {
        id: crypto.randomUUID(),
        threadId: activeThreadId ?? "t1",
        branchId: activeBranchId,
        parentId: localMessages.at(-1)?.id ?? null,
        role: "user",
        content,
        createdAt: new Date(),
      };
      setLocalMessages((prev) => [...prev, msg]);
    }
  };

  const handleNewThread = () => {
    if (apiAvailable) {
      createThread.mutate({ title: "New Thread", tags: [] });
    }
  };

  const handleSelectThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    // Reset branch to first branch of new thread
    setActiveBranchId("main");
  };

  return (
    <Shell
      sidebar={
        <Sidebar>
          {/* Thread list */}
          <div className="p-3">
            <button
              onClick={handleNewThread}
              className="mb-2 w-full rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white"
            >
              + New Thread
            </button>
            {threads.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelectThread(t.id)}
                className={`mb-1 block w-full truncate rounded px-2 py-1 text-left text-sm ${
                  t.id === activeThreadId
                    ? "bg-[var(--color-bg-elevated)] font-medium"
                    : "hover:bg-[var(--color-bg-elevated)]"
                }`}
              >
                {t.title}
              </button>
            ))}
          </div>

          {/* Navigation links */}
          <div className="flex gap-2 border-t border-[var(--color-border)] p-3">
            <Link
              href="/wiki"
              className="flex-1 rounded bg-[var(--color-bg-elevated)] px-3 py-1.5 text-center text-xs font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
            >
              Wiki
            </Link>
            <Link
              href="/explore"
              className="flex-1 rounded bg-[var(--color-bg-elevated)] px-3 py-1.5 text-center text-xs font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
            >
              Explore
            </Link>
          </div>

          {/* Branch tree */}
          <div className="p-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Branches
          </div>
          <BranchTree
            tree={branchTree}
            activeBranchId={activeBranchId}
            onSelect={setActiveBranchId}
          />
        </Sidebar>
      }
    >
      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <MessageList messages={messages as Message[]} />
        </div>
        <Composer onSend={handleSend} />
      </div>
    </Shell>
  );
}
