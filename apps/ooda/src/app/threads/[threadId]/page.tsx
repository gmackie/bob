import { notFound } from "next/navigation";

import { trpc, HydrateClient, fetchQuery } from "~/trpc/server";
import { ThreadShell } from "~/components/threads/thread-shell";

export default async function ThreadDetailPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId: slug } = await params;

  let thread;
  try {
    thread = await fetchQuery(
      trpc.threads.bySlug.queryOptions({ slug }),
    );
  } catch {
    // Query failed or thread not found
  }

  if (!thread) {
    notFound();
  }

  return (
    <HydrateClient>
      <ThreadShell
        thread={{
          id: thread.id,
          title: thread.title,
          slug: thread.slug,
          status: thread.status,
          domainPackId: thread.domainPackId,
        }}
      />
    </HydrateClient>
  );
}
