"use client";

import { useTRPC } from "~/trpc/react";
import { useMutation } from "@tanstack/react-query";
import { useSessionStream } from "~/hooks/use-session-stream";

interface ComparisonViewProps {
  sessionA: { id: string; adapterId: string };
  sessionB: { id: string; adapterId: string };
  threadId: string;
  onPromote?: (adapterId: string, content: string) => void;
  onClose: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-[#1A2E1A] text-green-400",
  failed: "bg-[#2E1A1A] text-red-400",
  running: "bg-[#2E2A1A] text-amber-400",
  pending: "bg-[#1A1A1E] text-[#8A8580]",
};

export function ComparisonView({
  sessionA,
  sessionB,
  threadId,
  onPromote,
  onClose,
}: ComparisonViewProps) {
  const sessions = [sessionA, sessionB];
  const streamA = useSessionStream(sessionA.id);
  const streamB = useSessionStream(sessionB.id);
  const streams = [streamA, streamB];

  const trpc = useTRPC();
  const promoteMutation = useMutation(
    trpc.runner.requestPromotion.mutationOptions(),
  );

  const handlePromote = (index: number) => {
    const session = sessions[index]!;
    const stream = streams[index]!;
    if (!stream.output) return;

    const title =
      stream.output.split("\n")[0]?.slice(0, 100) ?? "Comparison result";

    promoteMutation.mutate({
      sessionId: session.id,
      runnerId: "",
      threadId,
      kind: "observation",
      title,
      content: stream.output,
    });

    onPromote?.(session.adapterId, stream.output);
  };

  return (
    <div
      data-testid="comparison-view"
      className="flex h-full flex-col"
    >
      {/* Amber bar header */}
      <div className="flex items-center justify-between border-b border-[#D4A04A]/40 bg-[#2E2A1A] px-4 py-2">
        <span className="font-mono text-xs font-medium text-[#D4A04A]">
          Comparison Mode
        </span>
        <button
          onClick={onClose}
          className="rounded-[3px] border border-[#D4A04A]/30 px-2 py-0.5 font-mono text-xs text-[#D4A04A] hover:bg-[#D4A04A]/10"
        >
          Close
        </button>
      </div>

      {/* Two columns on md+, stacked on mobile. Side-by-side below md
          squeezes each stream under ~200px on a phone, making the
          monospace output unreadable; stacking keeps each column full-
          width and lets users scroll between them. */}
      <div className="flex min-h-0 flex-1 flex-col gap-0 md:flex-row">
        {sessions.map((session, i) => {
          const stream = streams[i]!;
          return (
            <div
              key={session.id}
              className={`flex flex-1 flex-col ${
                i > 0
                  ? "border-t border-[#2A2A2F] md:border-l md:border-t-0"
                  : ""
              }`}
            >
              <div className="flex items-center gap-2 border-b border-[#2A2A2F] bg-[#1A1A1E] px-4 py-2">
                <span className="font-mono text-sm font-medium text-[#E8E4DF]">
                  {session.adapterId}
                </span>
                <span
                  className={`rounded-[3px] px-1.5 py-0.5 text-xs ${
                    STATUS_STYLES[stream.status] ?? "bg-[#1A1A1E] text-[#8A8580]"
                  }`}
                >
                  {stream.status}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto bg-[#111113] p-4">
                {stream.status === "failed" ? (
                  <div className="rounded border border-red-900/50 bg-[#2E1A1A] p-3 text-sm text-red-400">
                    {stream.error ?? "Unknown error"}
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-sm text-[#E8E4DF]">
                    {stream.output || "Waiting for output..."}
                  </pre>
                )}
              </div>
              {stream.status === "completed" && stream.output && (
                <div className="border-t border-[#2A2A2F] bg-[#1A1A1E] px-4 py-2">
                  <button
                    onClick={() => handlePromote(i)}
                    disabled={promoteMutation.isPending}
                    className="rounded-[3px] border border-[#D4A04A]/30 bg-[#D4A04A]/10 px-3 py-1 font-mono text-xs text-[#D4A04A] hover:bg-[#D4A04A]/20 disabled:opacity-50"
                  >
                    {promoteMutation.isPending
                      ? "Promoting..."
                      : `Promote from ${session.adapterId}`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
