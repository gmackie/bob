"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createHermesClient,
  deriveHermesHealth,
  findLastBriefing,
  type HermesCronJob,
  type HermesMessagingPlatform,
} from "@bob/hermes-client";
import { Badge } from "@gmacko/core/ui/badge";
import { Button } from "@gmacko/core/ui/button";
import { Card } from "@gmacko/core/ui/card";
import { Input } from "@gmacko/core/ui/input";
import { Label } from "@gmacko/core/ui/label";

const hermes = createHermesClient();
const overviewKey = ["hermes", "overview"] as const;

function formatTime(value: string | number | null | undefined): string {
  if (!value) return "Never";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function stateBadge(state: string, healthy: boolean) {
  return <Badge variant={healthy ? "emerald" : "rose"}>{state.replaceAll("_", " ")}</Badge>;
}

function SectionTitle({ children, detail }: { children: React.ReactNode; detail: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-foreground">{children}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function ConnectorCard({
  platform,
  busy,
  onUpdate,
  onTest,
}: {
  platform: HermesMessagingPlatform;
  busy: boolean;
  onUpdate: (platform: HermesMessagingPlatform, values: Record<string, string>) => void;
  onTest: (platform: HermesMessagingPlatform) => void;
}) {
  const editableFields = platform.env_vars.filter((field) =>
    !field.is_set &&
    (field.required ||
      (platform.id === "telegram" && ["TELEGRAM_ALLOWED_USERS", "TELEGRAM_HOME_CHANNEL"].includes(field.key))),
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const telegramAllowlistReady = platform.id !== "telegram" ||
    platform.env_vars.find((field) => field.key === "TELEGRAM_ALLOWED_USERS")?.is_set ||
    Boolean(values.TELEGRAM_ALLOWED_USERS?.trim());
  const hasNewValue = Object.values(values).some((value) => value.trim());

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold text-foreground">{platform.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{platform.description}</p>
        </div>
        {stateBadge(platform.state, platform.state === "connected")}
      </div>

      {platform.error_message ? (
        <p className="mt-3 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{platform.error_message}</p>
      ) : null}

      {editableFields.length > 0 ? (
        <div className="mt-4 space-y-3">
          {editableFields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`hermes-${platform.id}-${field.key}`}>{field.prompt || field.key}</Label>
              <Input
                id={`hermes-${platform.id}-${field.key}`}
                className="mt-1"
                type={field.is_password ? "password" : "text"}
                autoComplete="off"
                placeholder={field.description}
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Saved directly to Hermes; Bob does not retain connector secrets.</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || editableFields.length === 0 || !hasNewValue || !telegramAllowlistReady}
          onClick={() => onUpdate(platform, values)}
        >
          Save &amp; enable
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !platform.configured} onClick={() => onTest(platform)}>
          Test connection
        </Button>
        {platform.configured ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onUpdate(platform, {})}>
            {platform.enabled ? "Disable" : "Enable"}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function AutomationRow({ job, busy, onAction }: { job: HermesCronJob; busy: boolean; onAction: (job: HermesCronJob, action: "pause" | "resume" | "run") => void }) {
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-display font-semibold text-foreground">{job.name || job.id}</h3>
            {stateBadge(job.enabled ? "active" : "paused", job.enabled)}
            {job.last_status === "failed" ? <Badge variant="rose">last run failed</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {job.schedule_display || job.schedule?.display || job.schedule?.expr || "No schedule"} · Next {formatTime(job.next_run_at)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction(job, job.enabled ? "pause" : "resume")}>
            {job.enabled ? "Pause" : "Resume"}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onAction(job, "run")}>Run now</Button>
        </div>
      </div>
    </Card>
  );
}

export function HermesConsole() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: overviewKey,
    queryFn: () => hermes.getOverview(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const action = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: overviewKey });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : "Hermes action failed"),
  });

  const data = overview.data;
  const health = data ? deriveHermesHealth(data) : null;
  const briefing = data ? findLastBriefing(data.jobs) : null;

  const run = (message: string | ((result: unknown) => string), work: () => Promise<unknown>) => {
    setNotice(null);
    action.mutate(work, { onSuccess: (result) => setNotice(typeof message === "function" ? message(result) : message) });
  };

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold text-foreground">Hermes</h1>
            {health ? stateBadge(health.label, health.tone === "success") : <Badge variant="slate">Loading</Badge>}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Operate the personal agent, connectors, automations, and recent activity.</p>
        </div>
        <Button asChild variant="outline"><Link href="/hermes/">Open stock dashboard</Link></Button>
      </div>

      {notice ? <p className="mt-5 rounded-md border border-border bg-accent/30 px-4 py-3 text-sm text-foreground">{notice}</p> : null}
      {overview.isError ? (
        <Card className="mt-6 border-rose-500/40 p-5">
          <p className="font-medium text-rose-300">Hermes is unreachable</p>
          <p className="mt-1 text-sm text-muted-foreground">{overview.error instanceof Error ? overview.error.message : "The proxy request failed."}</p>
          <Button className="mt-4" size="sm" onClick={() => overview.refetch()}>Retry</Button>
        </Card>
      ) : null}

      {data && health ? (
        <>
          <section className="mt-8 grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gateway</p>
              <p className="mt-2 font-display text-lg font-semibold text-foreground">{data.status.gateway_running ? "Running" : "Stopped"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Hermes {data.status.version}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider auth</p>
              <p className="mt-2 font-display text-lg font-semibold text-foreground">{data.providers.filter((provider) => provider.status.logged_in).length}/{data.providers.length} connected</p>
              <p className="mt-1 text-xs text-muted-foreground">{health.issues.find((issue) => issue.includes("provider")) || "All configured providers are ready"}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last briefing</p>
              <p className="mt-2 font-display text-lg font-semibold text-foreground">{briefing?.last_status || "No run recorded"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatTime(briefing?.last_run_at)}</p>
            </Card>
          </section>

          <section className="mt-10">
            <SectionTitle detail="Configure credentials, enable channels, and verify connectivity.">Connectors</SectionTitle>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {data.platforms.map((platform) => (
                <ConnectorCard
                  key={`${platform.id}:${platform.configured}:${platform.updated_at || "never"}`}
                  platform={platform}
                  busy={action.isPending}
                  onTest={(current) => run(
                    (result) => (result as { message: string }).message,
                    () => hermes.testMessagingPlatform(current.id),
                  )}
                  onUpdate={(current, values) => run(`Updated ${current.name}`, () => hermes.updateMessagingPlatform(current.id, {
                    enabled: Object.keys(values).length > 0 ? true : !current.enabled,
                    env: Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim())),
                  }))}
                />
              ))}
            </div>
          </section>

          <section className="mt-10">
            <SectionTitle detail="Pause, resume, or run Hermes schedules without leaving Bob.">Automations</SectionTitle>
            <div className="mt-4 space-y-3">
              {data.jobs.map((job) => (
                <AutomationRow key={`${job.profile || "default"}:${job.id}`} job={job} busy={action.isPending} onAction={(current, nextAction) => {
                  const profile = current.profile || current.profile_name || "default";
                  if (nextAction === "pause") run(`Paused ${current.name || current.id}`, () => hermes.pauseCronJob(current.id, profile));
                  else if (nextAction === "resume") run(`Resumed ${current.name || current.id}`, () => hermes.resumeCronJob(current.id, profile));
                  else run(`Started ${current.name || current.id}`, () => hermes.triggerCronJob(current.id, profile));
                }} />
              ))}
            </div>
          </section>

          <section className="mt-10">
            <SectionTitle detail={`${data.sessionTotal} total sessions; recent activity is read-only here.`}>Recent sessions</SectionTitle>
            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              {data.sessions.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No Hermes sessions yet.</p> : data.sessions.map((session) => (
                <div key={session.id} className="flex flex-col gap-2 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{session.title || session.preview || session.id}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{session.source || "interactive"} · {session.message_count} messages</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {session.is_active ? <Badge variant="emerald">active</Badge> : null}
                    {formatTime(session.last_active)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
