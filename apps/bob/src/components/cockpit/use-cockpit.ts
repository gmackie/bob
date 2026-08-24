"use client";

/**
 * Cockpit data: one status payload polled every 10 s, refetched immediately on
 * gateway workspace broadcasts, plus a live event feed per visible session.
 * The wall must keep working through gateway restarts: the socket reconnects
 * on its own, and `staleSeconds` drives the stale-data banner.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@bob/api";

import { useSessionSocket, type SessionEvent } from "~/hooks/use-session-socket";
import { useTRPC } from "~/trpc/react";

export type CockpitStatus = inferRouterOutputs<AppRouter>["cockpit"]["status"];
export type CockpitSession = CockpitStatus["sessions"][number];
export type CockpitPr = CockpitStatus["prs"]["active"][number];
export type CockpitQueueCard = CockpitStatus["queue"]["lanes"]["urgent"][number];

export interface TileFeed {
  /** Last lines of agent output (ring buffer). */
  tail: string[];
  /** Most recent tool call, if any. */
  tool: string | null;
  /** Latest file_changes payload. */
  files: {
    touched: string[];
    files: number;
    added: number;
    removed: number;
    topFiles: { path: string; added: number; removed: number }[];
    lastCommit: string | null;
  } | null;
  /** bob-check per-phase state (typecheck/lint/test/e2e/build). */
  check: Record<string, CheckPhaseState>;
  /** ms timestamp of the last event — drives the "streaming" pulse. */
  lastEventAt: number;
}

export interface CheckPhaseState {
  status: string;
  passed?: number;
  failed?: number;
  total?: number;
  durationMs?: number;
  /** Failing test names (check-events v2 only) — the tile shows the first few live. */
  failures?: string[];
  /** Per-stream running counts (v2): parallel suites report separately, tiles show the sum. */
  streams?: Record<string, { passed: number; failed: number; total?: number }>;
}

const TAIL_LINES = 8;

function emptyFeed(): TileFeed {
  return { tail: [], tool: null, files: null, check: {}, lastEventAt: 0 };
}

/**
 * Fold one check-events v2 event (run_started / test_finished / run_finished /
 * skipped, per-stream counts, CTRF-shaped test objects) into the tile's
 * per-phase state. v1 lines keep the legacy branch below — both shapes share
 * the `check` session event type.
 */
function applyCheckV2(feed: TileFeed, phase: string, payload: Record<string, unknown>): void {
  const kind = typeof payload.event === "string" ? payload.event : "";
  const prev = feed.check[phase] ?? { status: "running" };
  const next: CheckPhaseState = { ...prev, streams: { ...prev.streams } };
  const stream = typeof payload.stream === "string" ? payload.stream : "";
  const counts = payload.counts as
    | { passed?: number; failed?: number; total?: number }
    | undefined;

  if (kind === "run_started") {
    next.status = "running";
  } else if (kind === "skipped") {
    next.status = "skipped";
  } else if (kind === "run_finished") {
    const status = typeof payload.status === "string" ? payload.status : "failed";
    // a failed stream fails the phase for good — a later passing stream can't clear it
    next.status = prev.status === "failed" ? "failed" : status;
    if (typeof payload.durationMs === "number") {
      next.durationMs = Math.max(prev.durationMs ?? 0, payload.durationMs);
    }
  }

  if (counts && (kind === "test_finished" || kind === "run_finished")) {
    next.streams![stream] = {
      passed: counts.passed ?? 0,
      failed: counts.failed ?? 0,
      total: typeof counts.total === "number" ? counts.total : undefined,
    };
  }
  if (kind === "test_finished") {
    const test = payload.test as { name?: string; status?: string } | undefined;
    if (test?.status === "failed" && typeof test.name === "string") {
      const fails = prev.failures ?? [];
      if (!fails.includes(test.name)) next.failures = [...fails, test.name].slice(-3);
    }
  }

  const streamCounts = Object.values(next.streams!);
  if (streamCounts.length > 0) {
    next.passed = streamCounts.reduce((sum, c) => sum + c.passed, 0);
    next.failed = streamCounts.reduce((sum, c) => sum + c.failed, 0);
    const totals = streamCounts
      .map((c) => c.total)
      .filter((t): t is number => typeof t === "number");
    next.total =
      totals.length === streamCounts.length
        ? totals.reduce((sum, t) => sum + t, 0)
        : undefined;
  }
  feed.check = { ...feed.check, [phase]: next };
}

export function useCockpit(opts: { includeOoda: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const statusQuery = useQuery(
    trpc.cockpit.status.queryOptions(
      { includeOoda: opts.includeOoda },
      { refetchInterval: 10_000, staleTime: 5_000, refetchOnWindowFocus: false },
    ),
  );
  const status = statusQuery.data ?? null;

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined, { staleTime: 5 * 60_000 }),
  );

  const refetchStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: trpc.cockpit.status.queryKey() });
  }, [queryClient, trpc]);

  // Per-session live feeds, kept in a ref + version counter so a burst of
  // output doesn't re-render the whole wall on every chunk (we flush at 4 Hz).
  const feedsRef = useRef(new Map<string, TileFeed>());
  const [feedVersion, setFeedVersion] = useState(0);
  const dirtyRef = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setFeedVersion((v) => v + 1);
      }
    }, 250);
    return () => clearInterval(t);
  }, []);

  const onEvent = useCallback((event: SessionEvent) => {
    const feed = feedsRef.current.get(event.sessionId) ?? emptyFeed();
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.eventType === "output_chunk" && typeof payload.data === "string") {
      const lines = payload.data.split("\n").filter((l) => l.trim().length > 0);
      feed.tail = [...feed.tail, ...lines].slice(-TAIL_LINES);
    } else if (event.eventType === "tool_call") {
      const name = typeof payload.toolName === "string" ? payload.toolName : typeof payload.name === "string" ? payload.name : null;
      if (name) feed.tool = name;
    } else if (event.eventType === "thought" && typeof payload.text === "string") {
      feed.tail = [...feed.tail, `… ${payload.text}`].slice(-TAIL_LINES);
    } else if (event.eventType === "file_changes") {
      feed.files = payload as unknown as TileFeed["files"];
    } else if (event.eventType === "check") {
      const phase = typeof payload.phase === "string" ? payload.phase : "all";
      if (phase !== "all") {
        if (payload.v === 2) {
          applyCheckV2(feed, phase, payload);
        } else {
          // legacy bob-check v1 lines: one terminal object per phase
          feed.check = {
            ...feed.check,
            [phase]: {
              status: String(payload.status ?? "running"),
              passed: typeof payload.passed === "number" ? payload.passed : undefined,
              failed: typeof payload.failed === "number" ? payload.failed : undefined,
              total: typeof payload.total === "number" ? payload.total : undefined,
              durationMs: typeof payload.durationMs === "number" ? payload.durationMs : undefined,
            },
          };
        }
      }
    }
    feed.lastEventAt = Date.now();
    feedsRef.current.set(event.sessionId, feed);
    dirtyRef.current = true;
  }, []);

  const { connectionState: wsState, subscribe, unsubscribe } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: gatewayInfo?.token ?? "",
    enabled: !!gatewayInfo?.url && !!gatewayInfo?.token,
    onEvent,
    onWorkspaceStatusChanged: refetchStatus,
    onWorkspaceEvent: refetchStatus,
  });

  const connectionState = wsState.status;

  // Subscribe to exactly the visible sessions; drop feeds for finished ones.
  const sessionIds = useMemo(() => (status?.sessions ?? []).map((s) => s.id), [status]);
  const subscribedRef = useRef(new Set<string>());
  useEffect(() => {
    if (connectionState !== "connected") return;
    const want = new Set(sessionIds);
    for (const id of want) if (!subscribedRef.current.has(id)) subscribe(id, 0);
    for (const id of subscribedRef.current) {
      if (!want.has(id)) {
        unsubscribe(id);
        feedsRef.current.delete(id);
      }
    }
    subscribedRef.current = want;
  }, [sessionIds, connectionState, subscribe, unsubscribe]);

  const staleSeconds = status ? Math.max(0, Math.round((Date.now() - new Date(status.generatedAt).getTime()) / 1000)) : null;

  return {
    status,
    isLoading: statusQuery.isLoading,
    error: statusQuery.error,
    feeds: feedsRef.current,
    feedVersion,
    connectionState,
    staleSeconds,
  };
}
