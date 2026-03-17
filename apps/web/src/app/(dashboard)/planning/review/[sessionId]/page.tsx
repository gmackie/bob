"use client";

import { use } from "react";
import Link from "next/link";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { DraftPanel } from "~/components/planning/draft-panel";

interface ReviewPageProps {
  params: Promise<{ sessionId: string }>;
}

export default function PlanReviewPage({ params }: ReviewPageProps) {
  const { sessionId } = use(params);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Planning", href: "/planning" },
          { label: "Plan Review" },
        ]}
        className="mb-4"
      />

      <section className="rounded-[2rem] border border-border bg-gradient-to-br from-[#0e1628] via-[#13243a] to-[#0d111c] px-8 py-8">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Plan Review
            </div>
            <h1 className="mt-3 font-display text-3xl font-semibold text-foreground">
              Review Draft Tasks
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Review the tasks created during your planning session. Remove any
              you don&apos;t need, then commit to create them as real work items.
            </p>
          </div>
          <Link
            href="/planning"
            className="rounded-full border border-border px-4 py-2 text-sm text-secondary-foreground transition hover:border-muted-foreground/30 hover:text-foreground"
          >
            Back to Planning
          </Link>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-border bg-secondary p-6">
        <DraftPanel sessionId={sessionId} expanded />
      </section>
    </main>
  );
}
