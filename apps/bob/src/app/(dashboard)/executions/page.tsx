"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";
import { Card } from "@gmacko/core/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import {
  buildExecutionRow,
  getExecutionFilterHref,
  getExecutionFilters,
  normalizeExecutionFilter,
  type ExecutionRow,
  type ExecutionSessionInput,
  type ExecutionTone,
} from "~/components/executions/executions-model";
import { useBobQueryClient } from "~/rpc/react";

const PAGE_SIZE = 25;

const TONE_CLASSES: Record<ExecutionTone, string> = {
  default: "bg-muted text-muted-foreground",
  active: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  warning: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
};

export default function ExecutionsPage() {
  const bobQuery = useBobQueryClient();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const filter = normalizeExecutionFilter(searchParams.get("source"));
  // Cursor stack: the last entry is the cursor for the page being shown.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [stopResults, setStopResults] = useState<Record<string, string>>({});
  const cursor = cursors[cursors.length - 1];

  const listInput = {
    sessionType: "execution" as const,
    limit: PAGE_SIZE,
    ...(filter.source ? { source: filter.source } : {}),
    ...(cursor ? { cursor } : {}),
  };
  const { data, isLoading, error } = useQuery(
    bobQuery("agent.session.list").queryOptions(listInput, {
      refetchInterval: 15_000,
    }),
  );

  const stopSession = useMutation(
    bobQuery("agent.session.stop").mutationOptions({
      onSuccess: (_result, variables) => {
        setStopResults((prev) => ({ ...prev, [variables.id]: "Stop requested" }));
        void queryClient.invalidateQueries();
      },
      onError: (err, variables) => {
        setStopResults((prev) => ({ ...prev, [variables.id]: `Stop failed: ${err.message}` }));
      },
    }),
  );

  const now = new Date();
  const rows: ExecutionRow[] = (data?.items ?? []).map((session) =>
    buildExecutionRow(session as ExecutionSessionInput, now),
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Executions" }]} className="mb-4" />

      <h1 className="font-display text-3xl font-semibold text-foreground">Executions</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Sessions Bob is running or has run, including Autolab hypotheses dispatched by
        GenTrellis. Research progress and controls live in GenTrellis.
      </p>

      <nav aria-label="Execution filters" className="mt-6 flex flex-wrap gap-2">
        {getExecutionFilters().map((option) => (
          <Link
            key={option.key}
            href={getExecutionFilterHref(option.key)}
            onClick={() => setCursors([undefined])}
            aria-current={option.key === filter.key ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              option.key === filter.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      {error ? (
        <Card className="mt-6 p-6 text-sm text-rose-600">
          Couldn&apos;t load executions: {error.message}
        </Card>
      ) : isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading executions…</p>
      ) : rows.length === 0 ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted-foreground">
          {filter.source ? "No Autolab executions yet." : "No executions yet."}
        </Card>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-xs font-medium",
                      TONE_CLASSES[row.tone],
                    )}
                  >
                    {row.statusLabel}
                  </span>
                  {row.originLabel &&
                    (row.originHref ? (
                      <a
                        href={row.originHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        {row.originLabel} ↗
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">{row.originLabel}</span>
                    ))}
                </div>
                <Link
                  href={row.href}
                  className="mt-1 block truncate text-sm font-medium text-foreground hover:underline"
                >
                  {row.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[row.agentLabel, row.activityLabel].filter(Boolean).join(" · ")}
                </p>
                {row.branch && (
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {row.branch}
                  </p>
                )}
                {row.error && (
                  <p className="mt-1 line-clamp-2 text-xs text-rose-600">{row.error}</p>
                )}
                {stopResults[row.id] && (
                  <p role="status" className="mt-1 text-xs text-muted-foreground">
                    {stopResults[row.id]}
                  </p>
                )}
              </div>
              {row.canStop && (
                <button
                  type="button"
                  onClick={() => stopSession.mutate({ id: row.id })}
                  disabled={stopSession.isPending && stopSession.variables?.id === row.id}
                  className="shrink-0 self-start rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
                >
                  Stop
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex justify-between">
        <button
          type="button"
          disabled={cursors.length <= 1}
          onClick={() => setCursors((stack) => stack.slice(0, -1))}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Newer
        </button>
        <button
          type="button"
          disabled={!data?.nextCursor}
          onClick={() => data?.nextCursor && setCursors((stack) => [...stack, data.nextCursor])}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Older
        </button>
      </div>
    </main>
  );
}
