"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shell, Sidebar, MessageList, Composer, BranchTree } from "@gmacko/ui";
import type { Message, BranchTree as BranchTreeModel } from "@gmacko/models";
import { trpc } from "@/trpc/react";

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

  // --- tRPC queries -------------------------------------------------
  const threadsQuery = useQuery(trpc.threads.list.queryOptions());

  const threads = threadsQuery.data ?? [];
  const activeThreadId = selectedThreadId ?? threads[0]?.id;

  const branchesQuery = useQuery(
    trpc.branches.listByThread.queryOptions(
      { threadId: activeThreadId! },
      { enabled: !!activeThreadId },
    ),
  );

  const messagesQuery = useQuery(
    trpc.messages.listByBranch.queryOptions(
      { threadId: activeThreadId!, branchId: activeBranchId },
      { enabled: !!activeThreadId && activeBranchId !== "main" },
    ),
  );

  // --- tRPC mutations ------------------------------------------------
  const createThread = useMutation(
    trpc.threads.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [["threads", "list"]] });
      },
    }),
  );

  const sendMessage = useMutation(
    trpc.messages.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [["messages", "listByBranch"]],
        });
      },
    }),
  );

  // --- Derived state -------------------------------------------------
  const apiAvailable = !threadsQuery.isError;
  const messages = apiAvailable
    ? (messagesQuery.data ?? [])
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
      sendMessage.mutate({
        threadId: activeThreadId,
        branchId: activeBranchId,
        parentId: (messages as Message[]).at(-1)?.id ?? null,
        role: "user",
        content,
      });
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
      createThread.mutate({ title: "New Thread" });
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
