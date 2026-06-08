"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getLegacyPlanningBoardRedirectHref } from "~/components/planning/planning-shell-model";

export default function PlanningBoardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const href = getLegacyPlanningBoardRedirectHref(searchParams?.toString() ?? "");

  useEffect(() => {
    router.replace(href);
  }, [href, router]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm text-muted-foreground">
        Redirecting to Priority Queue...
      </p>
    </main>
  );
}
