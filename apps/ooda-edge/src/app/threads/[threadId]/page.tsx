"use client";

import { useEffect, useState } from "react";

import { LegacyThreadRedirect } from "~/components/conversations/legacy-thread-redirect";

export default function LegacyThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => {
    void params.then((value) => setSlug(value.threadId));
  }, [params]);
  return slug ? (
    <LegacyThreadRedirect slug={slug} />
  ) : (
    <div className="min-h-screen bg-[#111113]" />
  );
}
