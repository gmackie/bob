"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { DispatchPlan } from "~/components/planning/dispatch-plan";
import { getPlanningDashboardHref } from "~/components/planning/planning-shell-model";

interface Props {
  params: Promise<{ batchId: string }>;
}

export default function DispatchPage({ params }: Props) {
  const { batchId } = use(params);
  const searchParams = useSearchParams();
  const workspaceId = searchParams?.get("workspace") ?? null;
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Planning", href: getPlanningDashboardHref(workspaceId) },
          { label: "Dispatch Plan" },
        ]}
        className="mb-6"
      />
      <DispatchPlan batchId={batchId} />
    </main>
  );
}
