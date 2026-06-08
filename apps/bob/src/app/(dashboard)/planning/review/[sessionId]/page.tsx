import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { createPlanningCaller } from "~/lib/planning/server";
import { DraftPanel } from "~/components/planning/draft-panel";
import { getPlanningDashboardHref } from "~/components/planning/planning-shell-model";
import { getWorkItemEntryPlanSessionHref } from "~/components/work-items/work-item-entry-model";

interface ReviewPageProps {
  params: Promise<{ sessionId: string }>;
}

export const dynamic = "force-dynamic";

export default async function PlanReviewPage({ params }: ReviewPageProps) {
  const { sessionId } = await params;

  // Fetch session data to check for work-item linkage
  const caller = (await createPlanningCaller()) as any;
  const sessionData = await caller.planSession.get({ sessionId }).catch(() => null);

  // Redirect to split-view if session is linked to a work item
  if (sessionData?.session?.workItemId) {
    redirect(
      getWorkItemEntryPlanSessionHref(
        sessionData.session.workItemId,
        sessionId,
        sessionData.session.workspaceId,
      ),
    );
  }
  const planningHref = getPlanningDashboardHref(sessionData?.session?.workspaceId);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Planning", href: planningHref },
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
            href={planningHref}
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
