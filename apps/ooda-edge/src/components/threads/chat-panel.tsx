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

  const sendPromptText = (raw: string) => {
    const prompt = raw.trim();
    if (!prompt || !availableRunner) return;

    // Add user message immediately
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: prompt,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    sendMutation.mutate({
      threadId,
      runnerId: availableRunner,
      adapterId: chooseDefaultAdapter(
        runners.find((runner) => runner.id === availableRunner),
      ),
      toolProfileId: "default",
      prompt,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !availableRunner) return;
    sendPromptText(input);
    setInput("");
  };

  // Capture-first seeding: a thread opened from Capture carries the captured
  // text as ?prompt=. Auto-send it once (when a runner is ready), then strip it
  // from the URL so a refresh doesn't resend. If no runner is connected yet, it
  // waits in the input box instead.
  const seededRef = useRef(false);
  const [pendingSeed, setPendingSeed] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search).get("prompt");
    if (!p) return;
    setPendingSeed(p);
    setInput(p);
    const url = new URL(window.location.href);
    url.searchParams.delete("prompt");
    window.history.replaceState({}, "", url.toString());
  }, []);
  useEffect(() => {
    if (seededRef.current || !pendingSeed || !availableRunner) return;
    seededRef.current = true;
    sendPromptText(pendingSeed);
    setInput("");
    setPendingSeed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed, availableRunner]);

  const handlePromote = (msg: ChatMessage) => {
    if (!availableRunner) return;

    const title = msg.content.split("\n")[0]?.slice(0, 100) ?? "Untitled note";

    promoteMutation.mutate({
      sessionId: msg.id,
      runnerId: availableRunner,
      threadId,
      kind: "observation",
      title,
      content: msg.content,
    });
  };

  // "Remember this conversation" — the default keep gesture. Flags the whole
  // discussion as worth keeping: the runner folds it into the vault + KB with a
  // link back to this thread. Phase 1 promotes the transcript verbatim; the
  // agent-distilled summary lands in a follow-up. Keyed off the latest
  // assistant turn's session so the runner has the thread context.
  const handleRememberConversation = () => {
    if (!availableRunner || messages.length === 0) return;
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const sessionId = lastAssistant?.id ?? activeSessionId;
    if (!sessionId) return;

    const transcript = messages
      .map((m) => `**${m.role === "user" ? "You" : "OODA"}:** ${m.content}`)
      .join("\n\n");
    const firstUser = messages.find((m) => m.role === "user")?.content;
    const title = (firstUser?.split("\n")[0]?.slice(0, 100) ?? "Remembered conversation").trim();

    promoteMutation.mutate({
      sessionId,
      runnerId: availableRunner,
      threadId,
      kind: "source-extract",
      title: title || "Remembered conversation",
      content: transcript,
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
        {messages.length > 0 && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-[3px] border border-[#2A2A2F] bg-[#151517] px-3 py-1.5">
            <span className="min-w-0 truncate text-[11px] text-[#8A8580]">
              {promoteMutation.isSuccess
                ? "✓ Kept — folding into your vault + KB."
                : "Worth keeping? Fold this into your vault + knowledge base."}
            </span>
            <button
              type="button"
              onClick={handleRememberConversation}
              disabled={promoteMutation.isPending}
              className="shrink-0 rounded-[3px] border border-[#D4A04A] bg-[#D4A04A]/15 px-3 py-1 font-mono text-xs text-[#D4A04A] transition-colors hover:bg-[#D4A04A]/25 disabled:opacity-50"
            >
              {promoteMutation.isPending
                ? "Remembering…"
                : "★ Remember this"}
            </button>
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
