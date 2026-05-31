"use client";

import Link from "next/link";
import {
  ExclamationTriangleIcon,
  ExternalLinkIcon,
  QuestionMarkCircledIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useTRPC } from "~/trpc/react";

const metricLabels = {
  activeAgents: "Active agents",
  activeApiKeys: "Active API keys",
  activeTaskRuns: "Active runs",
  activeWebhooks: "Active webhooks",
  failedTaskRuns: "Failed runs",
  unreadNotifications: "Unread notifications",
  workItems: "Work items",
  workspaces: "Workspaces",
} as const;

export default function SupportPage() {
  const trpc = useTRPC();
  const { data, isLoading, error } = useQuery(
    trpc.support.telemetry.queryOptions(undefined),
  );

  const metrics = data?.metrics;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Support" }]} className="mb-4" />

      <header className="border-border mb-8 border-b pb-8">
        <div className="text-muted-foreground text-xs font-semibold tracking-[0.18em] uppercase">
          Support model
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-semibold">Support</h1>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6">
              Report product issues, check operational controls, and review the
              telemetry Bob exposes for your workspace.
            </p>
          </div>
          <Badge variant={data?.emergencyDisabled ? "rose" : "emerald"}>
            {data?.emergencyDisabled ? "Emergency disabled" : "Operational"}
          </Badge>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="border-border rounded-lg border p-5">
          <QuestionMarkCircledIcon className="text-primary size-5" />
          <h2 className="mt-4 text-sm font-semibold">Bug reports</h2>
          <p className="text-muted-foreground mt-2 min-h-16 text-sm leading-6">
            File reproducible bugs with context, screenshots, affected
            workspace, and expected behavior.
          </p>
          <Button asChild className="mt-4 w-full" size="sm">
            <a
              href={data?.bugReportUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
            >
              Open bug report
              <ExternalLinkIcon />
            </a>
          </Button>
        </section>

        <section className="border-border rounded-lg border p-5">
          <ExclamationTriangleIcon className="text-primary size-5" />
          <h2 className="mt-4 text-sm font-semibold">Emergency disable</h2>
          <p className="text-muted-foreground mt-2 min-h-16 text-sm leading-6">
            Operators can set{" "}
            <code className="font-mono">BOB_EMERGENCY_DISABLED</code> to block
            product access while keeping support and health checks online.
          </p>
          <div className="bg-muted text-muted-foreground mt-4 rounded-md px-3 py-2 text-xs">
            {data?.emergencyReason ?? "No active emergency disable reason."}
          </div>
        </section>

        <section className="border-border rounded-lg border p-5">
          <ExternalLinkIcon className="text-primary size-5" />
          <h2 className="mt-4 text-sm font-semibold">Support contact</h2>
          <p className="text-muted-foreground mt-2 min-h-16 text-sm leading-6">
            Use email for account access, billing, privacy, or incidents that
            should not be filed publicly.
          </p>
          <Button asChild className="mt-4 w-full" size="sm" variant="outline">
            <a href={`mailto:${data?.supportEmail ?? "support@blder.bot"}`}>
              Email support
            </a>
          </Button>
        </section>
      </div>

      <section className="border-border mt-8 rounded-lg border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Telemetry dashboard</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Current account telemetry used for support triage.
            </p>
          </div>
          <span className="text-muted-foreground text-xs">
            Updated{" "}
            {data?.generatedAt
              ? new Date(data.generatedAt).toLocaleString()
              : "now"}
          </span>
        </div>

        {error ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive mt-5 rounded-md border p-4 text-sm">
            Telemetry is unavailable for this session.
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(metricLabels).map(([key, label]) => (
              <div
                key={key}
                className="border-border bg-muted/30 rounded-md border p-4"
              >
                <div className="text-muted-foreground text-xs font-medium">
                  {label}
                </div>
                <div className="font-display mt-2 text-2xl font-semibold">
                  {isLoading
                    ? "..."
                    : (metrics?.[key as keyof typeof metricLabels] ?? 0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/settings?section=webhooks">Review webhook settings</Link>
        </Button>
      </div>
    </div>
  );
}
