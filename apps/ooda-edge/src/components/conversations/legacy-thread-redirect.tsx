"use client";

import { conversationUrlForLegacyThread } from "@gmacko/ooda-client/v1";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTRPC } from "~/trpc/react";

export function LegacyThreadRedirect({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const threadQuery = useQuery(trpc.threads.bySlug.queryOptions({ slug }));
  const thread = threadQuery.data as { id: string } | undefined;

  useEffect(() => {
    if (thread?.id) {
      window.location.replace(conversationUrlForLegacyThread(thread.id));
    }
  }, [thread?.id]);

  if (threadQuery.isLoading)
    return <RedirectState label="Resolving migrated thread…" />;
  if (threadQuery.error) {
    return (
      <RedirectState
        label={`Could not resolve this legacy thread: ${threadQuery.error.message}`}
      />
    );
  }
  if (!thread) {
    return <RedirectState label="This legacy thread no longer exists." />;
  }
  return <RedirectState label="Opening canonical conversation…" />;
}

function RedirectState({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#111113] px-6 text-center text-sm text-[#8A8580]">
      <div>
        <p>{label}</p>
        <a
          href="/conversations"
          className="mt-4 inline-block text-xs text-[#D4A04A] hover:underline"
        >
          Open conversations
        </a>
      </div>
    </div>
  );
}
