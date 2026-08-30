"use client";

/**
 * Agent credential management.
 *
 * Every agent-outage postmortem in this repo ended at the same wall: the
 * runtime could detect a dead agent but never fix one. On 2026-08-29 all three
 * agents on the host were down at once and the only remedy was SSH plus a
 * hand-run auth script, so the outage lasted eight days.
 *
 * This is the fix button. It shows what the host actually reports, and offers
 * the remedy that matches — which is not always "sign in". An exhausted balance
 * needs a top-up; re-authenticating there fixes nothing, and offering it is how
 * an operator loops on the wrong action for a week.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Badge } from "@gmacko/core/ui/badge";
import { Card } from "@gmacko/core/ui/card";
import { cn } from "@gmacko/core/ui";
import type {
  HostSnapshotWire,
  ServerAgentAuthPrompt,
  ServerAgentAuthResult,
  ServerDispatchState,
  DispatchAction,
} from "@bob/ws";

import { useSessionSocket } from "~/hooks/use-session-socket";
import { useTRPC } from "~/trpc/react";
import {
  PROVIDER_BILLING_URLS,
  buildHostMissionControl,
} from "~/components/dashboard/mission-control-model";

const PROVIDER_INSTALL_HINTS: Record<string, string> = {
  claude: "npm i -g @anthropic-ai/claude-code",
  codex: "npm i -g @openai/codex",
  grok: "see grok CLI install docs",
  "cursor-agent": "see Cursor CLI install docs",
};

type DispatchUi =
  | { kind: "idle"; running?: boolean }
  | { kind: "pending"; action: DispatchAction }
  | { kind: "error"; detail: string };

type Phase =
  | { kind: "idle" }
  | { kind: "starting"; provider: string; requestId: string }
  | {
      kind: "prompt";
      provider: string;
      requestId: string;
      url?: string;
      code?: string;
      instructions: string;
      tail?: string;
    }
  | { kind: "done"; provider: string; ok: boolean; detail?: string };

function statusTone(status: string): string {
  switch (status) {
    case "ready":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "no_credit":
    case "rate_limited":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300";
    case "unauthenticated":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    default:
      return "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300";
  }
}

export function AgentCredentials({ workspaceId }: { workspaceId: string }) {
  const trpc = useTRPC();
  const [hostSnapshot, setHostSnapshot] = useState<HostSnapshotWire | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [codeInput, setCodeInput] = useState("");
  /**
   * Local echo for the runner control. `running` is only set from a confirmed
   * dispatch_state; until one arrives the host snapshot is the source of truth.
   */
  const [dispatch, setDispatch] = useState<DispatchUi>({ kind: "idle" });

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined, {
      enabled: Boolean(workspaceId),
    }),
  );

  const onAgentAuthPrompt = useCallback((msg: ServerAgentAuthPrompt) => {
    setPhase((current) => {
      // Ignore prompts for a request we are not showing — another tab may be
      // driving a different login on the same host.
      const requestId = "requestId" in current ? current.requestId : null;
      if (requestId !== msg.requestId) return current;
      return {
        kind: "prompt",
        provider: msg.provider,
        requestId: msg.requestId,
        url: msg.url,
        code: msg.code,
        instructions: msg.instructions,
        tail: msg.tail,
      };
    });
  }, []);

  const onDispatchState = useCallback((msg: ServerDispatchState) => {
    setDispatch(
      msg.ok
        ? { kind: "idle", running: msg.running }
        : { kind: "error", detail: msg.detail ?? "Could not change the runner" },
    );
  }, []);

  const onAgentAuthResult = useCallback((msg: ServerAgentAuthResult) => {
    setPhase((current) => {
      const requestId = "requestId" in current ? current.requestId : null;
      if (requestId !== msg.requestId) return current;
      return { kind: "done", provider: msg.provider, ok: msg.ok, detail: msg.detail };
    });
  }, []);

  const { connectionState, subscribeWorkspace } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: gatewayInfo?.token ?? "",
    enabled: Boolean(workspaceId && gatewayInfo?.url && gatewayInfo?.token),
    onHostSnapshot: (_ws, snapshot) => setHostSnapshot(snapshot),
    onAgentAuthPrompt,
    onAgentAuthResult,
    onDispatchState,
  });

  useEffect(() => {
    if (connectionState.status !== "connected" || !workspaceId) return;
    subscribeWorkspace(undefined, workspaceId);
  }, [connectionState.status, workspaceId, subscribeWorkspace]);

  const startMutation = useMutation(trpc.agentAuth.start.mutationOptions({}));
  const codeMutation = useMutation(trpc.agentAuth.submitCode.mutationOptions({}));
  const cancelMutation = useMutation(trpc.agentAuth.cancel.mutationOptions({}));
  const dispatchMutation = useMutation(trpc.dispatchControl.set.mutationOptions({}));

  const host = useMemo(
    () => (hostSnapshot ? buildHostMissionControl(hostSnapshot) : null),
    [hostSnapshot],
  );
  const providers = host?.providers ?? [];

  const startAuth = (provider: string) => {
    const requestId = crypto.randomUUID();
    setCodeInput("");
    setPhase({ kind: "starting", provider, requestId });
    startMutation.mutate(
      { workspaceId, provider: provider as never, requestId },
      {
        onError: (error) =>
          setPhase({ kind: "done", provider, ok: false, detail: error.message }),
      },
    );
  };

  const submitCode = () => {
    if (phase.kind !== "prompt" || !codeInput.trim()) return;
    codeMutation.mutate({ workspaceId, requestId: phase.requestId, value: codeInput.trim() });
    setCodeInput("");
  };

  const closeDialog = () => {
    if (phase.kind === "prompt" || phase.kind === "starting") {
      cancelMutation.mutate({ workspaceId, requestId: phase.requestId });
    }
    setPhase({ kind: "idle" });
  };

  // Confirmed state wins; fall back to the host snapshot, and leave it unknown
  // when neither says. A daemon that predates dispatch control reports nothing.
  const runnerRunning = dispatch.kind === "idle" ? (dispatch.running ?? host?.dispatchRunning) : host?.dispatchRunning;

  const setDispatchAction = (action: DispatchAction) => {
    const requestId = crypto.randomUUID();
    setDispatch({ kind: "pending", action });
    dispatchMutation.mutate(
      { workspaceId, action, requestId },
      {
        onError: (error) => setDispatch({ kind: "error", detail: error.message }),
      },
    );
  };

  if (!hostSnapshot) {
    return (
      <Card className="p-4">
        <h2 className="font-display text-lg font-semibold">Agent credentials</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {connectionState.status === "connected"
            ? "Waiting for the host to report agent status…"
            : "Connecting to the host…"}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Agent credentials</h2>
        <span className="text-xs text-muted-foreground">
          checked {new Date(hostSnapshot.checkedAt).toLocaleTimeString()}
        </span>
      </div>

      {/* The breaker is the difference between an outage and an outage that
          also burns the backlog. On 2026-08-29 the runner kept claiming work
          against three dead agents for eight days. */}
      {host?.dispatchPaused ? (
        <div
          className="mt-3 rounded-md border border-red-500/50 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300"
          data-testid="dispatch-paused-banner"
        >
          <strong className="font-semibold">Dispatch paused.</strong> Every agent on this node is
          confirmed unavailable, so the runner has stopped claiming work rather than burning the
          backlog. Fix an agent below to resume, or set{" "}
          <code className="font-mono text-xs">BOB_DISPATCH_OVERRIDE=1</code> on the runner to force
          dispatch anyway.
        </div>
      ) : null}

      {/* The runner is a separate process that polls Linear directly and holds
          no connection to Bob, so a stopped one could previously only be
          restarted over SSH — the same wall this card exists to remove. */}
      {runnerRunning === undefined ? null : (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2"
          data-testid="dispatch-runner-control"
        >
          <span className="font-medium">Task runner</span>
          <Badge
            className={cn(
              "text-xs",
              runnerRunning
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                : "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
            )}
          >
            {runnerRunning ? "Running" : "Stopped"}
          </Badge>
          <div className="ml-auto">
            <button
              type="button"
              disabled={dispatch.kind === "pending"}
              onClick={() => setDispatchAction(runnerRunning ? "stop" : "start")}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50",
                runnerRunning
                  ? "border border-border hover:bg-muted"
                  : "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              {dispatch.kind === "pending"
                ? "Working…"
                : runnerRunning
                  ? "Stop"
                  : "Start"}
            </button>
          </div>
          {dispatch.kind === "error" ? (
            <p className="w-full text-xs text-red-700 dark:text-red-400">{dispatch.detail}</p>
          ) : null}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {providers.map((provider) => (
          <div
            key={provider.provider}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2"
            data-testid={`agent-credential-${provider.provider}`}
          >
            <span className="font-medium">{provider.label}</span>
            <Badge className={cn("text-xs", statusTone(provider.status))}>
              {provider.statusLabel}
            </Badge>
            {provider.version ? (
              <span className="text-xs text-muted-foreground">{provider.version}</span>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              {/* The remedy is state-dependent, and that is the whole point. */}
              {provider.remedy === "sign_in" ? (
                <button
                  type="button"
                  onClick={() => startAuth(provider.provider)}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  Sign in
                </button>
              ) : null}
              {provider.remedy === "top_up" ? (
                <a
                  href={PROVIDER_BILLING_URLS[provider.provider] ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-amber-500 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/20"
                >
                  Top up
                </a>
              ) : null}
              {/* No control: a quota lifts on its own. The detail line carries
                  the provider's own wording, which is where the reset time is. */}
              {provider.remedy === "wait" ? (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  waits for the provider limit to reset
                </span>
              ) : null}
              {provider.remedy === "install" ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {PROVIDER_INSTALL_HINTS[provider.provider] ?? "not installed"}
                </span>
              ) : null}
            </div>

            {provider.detail ? (
              <p className="w-full text-xs text-muted-foreground">{provider.detail}</p>
            ) : null}
          </div>
        ))}
      </div>

      {phase.kind !== "idle" ? (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3" role="dialog">
          {phase.kind === "starting" ? (
            <p className="text-sm">Starting {phase.provider} sign-in on the host…</p>
          ) : null}

          {phase.kind === "prompt" ? (
            <div className="space-y-2">
              <p className="text-sm">{phase.instructions}</p>
              {phase.url ? (
                <a
                  href={phase.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-sm text-primary underline"
                >
                  {phase.url}
                </a>
              ) : null}
              {phase.code ? (
                <p className="text-sm">
                  Code: <span className="font-mono text-base font-semibold">{phase.code}</span>
                </p>
              ) : null}
              {/* Fail-open: no matcher fired, so show what the CLI actually said
                  rather than dead-ending the operator back into an SSH session. */}
              {phase.tail ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs">
                  {phase.tail}
                </pre>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCode();
                  }}
                  placeholder="Paste code here if the CLI asks for one"
                  className="min-w-[16rem] flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={submitCode}
                  disabled={!codeInput.trim()}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            </div>
          ) : null}

          {phase.kind === "done" ? (
            <p className={cn("text-sm", phase.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>
              {phase.ok
                ? `${phase.provider} is signed in.`
                : `${phase.provider} sign-in failed${phase.detail ? `: ${phase.detail}` : ""}`}
            </p>
          ) : null}

          <button
            type="button"
            onClick={closeDialog}
            className="mt-2 text-xs text-muted-foreground underline"
          >
            {phase.kind === "done" ? "Close" : "Cancel"}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
