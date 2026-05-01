"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";
import { ThreadShell } from "~/components/threads/thread-shell";

export default function ThreadDetailPage({
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

  return <ThreadDetailInner slug={slug} />;
}

function ThreadDetailInner({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const threadQuery = useQuery(trpc.threads.bySlug.queryOptions({ slug }));

  if (threadQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#111113] text-[#5A5855]">
        Loading thread...
      </div>
    );
  }

  const thread = threadQuery.data;
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
    <ThreadShell
      thread={{
        id: thread.id,
        title: thread.title,
        slug: thread.slug,
        status: thread.status,
        domainPackId: thread.domainPackId,
      }}
    />
  );
}
