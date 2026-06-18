import { notFound } from "next/navigation";

import { trpc, HydrateClient, fetchQuery } from "~/trpc/server";

import { FindingsRail } from "./_components/FindingsRail";
import { GraphCanvas } from "./_components/GraphCanvas";
import { ToolFeed } from "./_components/ToolFeed";

export default async function ThreadResearchPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId: slug } = await params;

  let thread;
  try {
    thread = await fetchQuery(trpc.threads.bySlug.queryOptions({ slug }));
  } catch {
    // Query failed or thread not found.
  }

  if (!thread) {
    notFound();
  }

  return (
    <HydrateClient>
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
    </HydrateClient>
  );
}
