"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

import { FindingsRail } from "./_components/FindingsRail";
import { GraphCanvas } from "./_components/GraphCanvas";
import { ToolFeed } from "./_components/ToolFeed";

export default function ThreadResearchPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setSlug(p.threadId));
  }, [params]);

  if (!slug) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#111113] text-[#5A5855]">
        Loading...
      </div>
    );
  }

  return <ThreadResearchInner slug={slug} />;
}

function ThreadResearchInner({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const threadQuery = useQuery(trpc.threads.bySlug.queryOptions({ slug }));

  if (threadQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#111113] text-[#5A5855]">
        Loading thread...
      </div>
    );
  }

  // `threads.bySlug` declares `.output(z.any())` (required by
  // trpc-to-openapi), which degenerates the client-inferred type.
  const thread = threadQuery.data as { id: string } | undefined;
  if (!thread) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#111113] text-[#E8E4DF]">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Thread not found</h1>
          <a href="/threads" className="mt-4 inline-block text-[#D4A04A] hover:underline">
            Back to threads
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 gap-0 lg:grid-cols-[1fr_minmax(320px,24rem)_minmax(320px,24rem)]">
      <div className="min-h-[200px] border-r border-[#2A2826] lg:min-h-[50vh]">
        <GraphCanvas threadId={thread.id} />
      </div>
      <div className="min-h-[200px] border-r border-[#2A2826] lg:min-h-[50vh]">
        <FindingsRail threadId={thread.id} />
      </div>
      <div className="min-h-[200px] lg:min-h-[50vh]">
        <ToolFeed threadId={thread.id} />
      </div>
    </div>
  );
}
