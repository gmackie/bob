"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

import { useTRPC } from "~/trpc/react";
import { CreateThreadModal } from "~/components/threads/create-thread-modal";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const EXAMPLE_TOPICS = [
  "Optimize sleep quality with supplements",
  "Compare investment strategies for early retirement",
  "Evaluate latest breakthroughs in battery technology",
];

// `threads.list` is declared `.output(z.any())` (required by trpc-to-openapi),
// which degenerates the client-inferred query data type. Describe the real
// `researchThread` row shape the UI consumes so the cast below stays honest.
interface ThreadSummary {
  id: string;
  slug: string;
  title: string;
  status: string;
  createdAt: Date | string | null;
  domainPackId: string | null;
}

export default function ThreadsPage() {
  return (
    <Suspense>
      <ThreadsPageInner />
    </Suspense>
  );
}

function ThreadsPageInner() {
  const [modalOpen, setModalOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Auto-open create modal when ?new=1 is present
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setModalOpen(true);
      // Clean the URL param without a navigation
      router.replace("/threads", { scroll: false });
    }
  }, [searchParams, router]);

  const threadsQuery = useQuery(trpc.threads.list.queryOptions());

  const createMutation = useMutation(
    trpc.threads.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.threads.list.queryKey(),
        });
        setModalOpen(false);
      },
    }),
  );

  const threads = (threadsQuery.data ?? []) as unknown as ThreadSummary[];

  return (
    <div className="min-h-screen bg-[#111113] text-[#E8E4DF]">
    <div className="mx-auto max-w-4xl px-3 py-6 md:px-6 md:py-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-[#D4A04A]">
          Research Threads
        </h1>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-[3px] bg-[#D4A04A] px-4 py-2.5 text-sm font-medium text-[#111113] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#D4A04A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113]"
        >
          New Thread
        </button>
      </div>

      {/* Thread list */}
      <div className="mt-8">
        {threadsQuery.isLoading ? (
          <div className="py-12 text-center text-sm text-[#5A5855]">
            Loading...
          </div>
        ) : threads.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] px-6 py-16 text-center">
            <h2 className="font-serif text-lg text-[#E8E4DF]">
              Start your first research thread
            </h2>
            <p className="mt-2 max-w-md text-sm text-[#8A8580]">
              Threads organize your research into focused investigations. Each
              thread has its own chat history and workspace.
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="mt-6 rounded-[3px] bg-[#D4A04A] px-5 py-2 text-sm font-medium text-[#111113] transition-opacity hover:opacity-90"
            >
              Create Your First Thread
            </button>
            <div className="mt-8 w-full max-w-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-[#5A5855]">
                Example topics
              </p>
              <div className="mt-3 space-y-2">
                {EXAMPLE_TOPICS.map((topic) => (
                  <div
                    key={topic}
                    className="rounded-[3px] border border-[#2A2A2F] px-3 py-2 text-left text-sm text-[#8A8580]"
                  >
                    {topic}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Thread cards */
          <div className="space-y-2">
            {threads.map((thread) => (
              <Link
                key={thread.id}
                href={`/threads/${thread.slug}`}
                className="block rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] p-4 transition-colors duration-150 hover:border-[#D4A04A]/30 focus-visible:ring-2 focus-visible:ring-[#D4A04A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113]"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="font-serif text-base font-medium text-[#E8E4DF]">
                    {thread.title}
                  </h3>
                  <span className="self-start rounded-[3px] bg-[#111113] px-2 py-0.5 text-xs text-[#5A5855] sm:self-auto">
                    {thread.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#5A5855] md:gap-3">
                  <span className="font-mono">/{thread.slug}</span>
                  {thread.createdAt && (
                    <span>
                      {new Date(thread.createdAt).toLocaleDateString()}
                    </span>
                  )}
                  {thread.domainPackId && (
                    <span className="rounded-[3px] bg-[#1A1A1E] px-2 py-0.5 font-mono text-xs text-[#5A5855]">
                      {thread.domainPackId}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      <CreateThreadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={(data) => createMutation.mutate(data)}
      />
    </div>
    </div>
  );
}
