"use client";

import { use } from "react";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { DispatchPlan } from "~/components/planning/dispatch-plan";

interface Props {
  params: Promise<{ batchId: string }>;
}

export default function DispatchPage({ params }: Props) {
  const { batchId } = use(params);
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Planning", href: "/planning" },
          { label: "Dispatch Plan" },
        ]}
        className="mb-6"
      />
      <DispatchPlan batchId={batchId} />
    </main>
  );
}
