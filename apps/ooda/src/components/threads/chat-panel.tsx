"use client";

import { useState, useEffect, useRef } from "react";

import { useTRPC } from "~/trpc/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionStream } from "~/hooks/use-session-stream";

import { chooseDefaultAdapter, type RunnerDevice } from "./adapter-selection";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface ChatPanelProps {
  threadId: string;
  runnerId?: string;
  onPromoted?: () => void;
}

export function ChatPanel({ threadId, runnerId, onPromoted }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const sessionStream = useSessionStream(activeSessionId);

  useEffect(() => {
    if (!activeSessionId) return;
    if (!sessionStream.output) return;

    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.id === activeSessionId) {
        return [
          ...prev.slice(0, -1),
          { ...last, content: sessionStream.output },
        ];
      }
      return [
        ...prev,
        {
          id: activeSessionId,
          role: "assistant" as const,
          content: sessionStream.output,
          timestamp: new Date().toLocaleTimeString(),
        },
      ];
    });

    if (
      sessionStream.status === "completed" ||
      sessionStream.status === "failed"
    ) {
      setActiveSessionId(null);
    }
  }, [sessionStream.output, sessionStream.status, activeSessionId]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Get available runners
  const runnersQuery = useQuery(trpc.runner.listDevices.queryOptions());
  const runners = (runnersQuery.data ?? []) as RunnerDevice[];
  const availableRunner = runnerId ?? runners[0]?.id;

  const sendMutation = useMutation(
    trpc.runner.sendPrompt.mutationOptions({
      onSuccess: (session) => {
        if (session) {
          setActiveSessionId(session.id);
        }
      },
    }),
  );

  const promoteMutation = useMutation(
    trpc.runner.requestPromotion.mutationOptions({
      onSuccess: () => {
        onPromoted?.();
        void queryClient.invalidateQueries({
          queryKey: trpc.runner.getSessionEvents.queryKey({
            sessionId: activeSessionId ?? "",
          }),
        });
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !availableRunner) return;

    // Add user message immediately
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: input.trim(),
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    // Send to runner
    sendMutation.mutate({
      threadId,
      runnerId: availableRunner,
      adapterId: chooseDefaultAdapter(
        runners.find((runner) => runner.id === availableRunner),
      ),
      toolProfileId: "default",
      prompt: input.trim(),
    });

    setInput("");
  };

  const handlePromote = (msg: ChatMessage) => {
    if (!availableRunner) return;

    // For v1: auto-derive title from first line, kind defaults to observation
    const title = msg.content.split("\n")[0]?.slice(0, 100) ?? "Untitled note";

    promoteMutation.mutate({
      sessionId: msg.id, // The session ID is used as the message ID for assistant messages
      runnerId: availableRunner,
      threadId,
      kind: "observation",
      title,
      content: msg.content,
    });
  };

  const isRunning = !!activeSessionId;

  return (
    <div data-testid="chat-panel" className="flex h-full flex-col">
      {/* Message list */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[#5A5855]">
              Start a research session by sending a message.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-[6px] px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-[#D4A04A]/15 text-[#E8E4DF]"
                    : "bg-[#1A1A1E] text-[#E8E4DF]"
                }`}
              >
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                <span className="mt-1 block font-mono text-[10px] text-[#5A5855]">
                  {msg.timestamp}
                </span>
                {msg.role === "assistant" && (
                  <button
                    onClick={() => handlePromote(msg)}
                    disabled={promoteMutation.isPending}
                    className="mt-2 rounded-[3px] border border-[#2A2A2F] bg-[#D4A04A]/10 px-2 py-0.5 font-mono text-[10px] text-[#D4A04A] transition-colors hover:border-[#D4A04A] hover:bg-[#D4A04A]/20 disabled:opacity-50"
                  >
                    {promoteMutation.isPending ? "Promoting..." : "Promote to workspace"}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-[#2A2A2F] p-3 pb-6 md:pb-3"
      >
        {!availableRunner && (
          <div className="mb-2 rounded-[3px] bg-[#2E2A1A] px-3 py-1.5 text-xs text-amber-400">
            No runner connected. Start the runner with pnpm dev.
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRunning ? "Agent is working..." : "Ask a research question..."}
            disabled={isRunning}
            className="flex-1 rounded-[3px] border border-[#2A2A2F] bg-[#1A1A1E] px-3 py-2.5 text-sm text-[#E8E4DF] placeholder-[#5A5855] outline-none focus:border-[#D4A04A] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || !availableRunner || isRunning}
            className="rounded-[3px] bg-[#D4A04A] px-4 py-2.5 text-sm font-medium text-[#111113] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isRunning ? "Running..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
