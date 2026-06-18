"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface SessionStreamState {
  output: string;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
}

/**
 * Streams session output via SSE (live) with tRPC query for content.
 *
 * The session_output NOTIFY only carries { session_id, type } -- not content.
 * When SSE notifies of a new chunk, we bump a refetch counter to trigger
 * a tRPC query that fetches new events from the DB. This avoids duplicating
 * content in the NOTIFY payload and keeps the query as the single source
 * of truth for event content.
 *
 * For completed/failed sessions the EventSource is not opened -- the initial
 * query fetch is sufficient.
 */
export function useSessionStream(
  sessionId: string | null,
): SessionStreamState {
  const [status, setStatus] = useState<SessionStreamState["status"]>("pending");
  const [error, setError] = useState<string | undefined>(undefined);
  const [sseTicket, setSseTicket] = useState(0);
  const outputRef = useRef("");
  const [output, setOutput] = useState("");

  const trpc = useTRPC();

  const eventsQuery = useQuery({
    ...trpc.runner.getSessionEvents.queryOptions({
      sessionId: sessionId ?? "",
    }),
    enabled: !!sessionId,
    // Re-fetch whenever SSE notifies us of a new event.
    // sseTicket is bumped by the EventSource listener.
    // eslint-disable-next-line @tanstack/query/no-rest-destructuring
    refetchInterval: false,
  });

  // Rebuild output from the full event list whenever the query returns.
  useEffect(() => {
    if (!eventsQuery.data || eventsQuery.data.length === 0) return;

    let accumulated = "";
    let ended = false;
    let errMsg: string | undefined;

    for (const event of eventsQuery.data) {
      if (event.type === "stdout_chunk") {
        accumulated += event.content;
      }
      if (event.type === "exit") ended = true;
      if (event.type === "error") {
        ended = true;
        errMsg = event.content;
      }
    }

    // If no chunks yet, fall back to the legacy single stdout event.
    if (!accumulated) {
      for (const event of eventsQuery.data) {
        if (event.type === "stdout") {
          accumulated += event.content;
        }
      }
    }

    if (accumulated && accumulated !== outputRef.current) {
      outputRef.current = accumulated;
      setOutput(accumulated);
    }

    if (ended) {
      setStatus(errMsg ? "failed" : "completed");
      if (errMsg) setError(errMsg);
    } else if (accumulated) {
      setStatus("running");
    }
  }, [eventsQuery.data]);

  // Refetch when SSE ticket bumps
  useEffect(() => {
    if (sseTicket > 0) {
      void eventsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sseTicket]);

  // Open EventSource for live streaming notifications
  useEffect(() => {
    if (!sessionId) return;
    if (status === "completed" || status === "failed") return;

    const url = `/api/runner/events?sessionId=${encodeURIComponent(sessionId)}`;
    const es = new EventSource(url);

    es.addEventListener("session_output", (e: MessageEvent<string>) => {
      let payload: { session_id?: string; type?: string };
      try {
        payload = JSON.parse(e.data) as {
          session_id?: string;
          type?: string;
        };
      } catch {
        return;
      }

      if (
        payload.type === "stdout_chunk" ||
        payload.type === "stdout"
      ) {
        setStatus("running");
        setSseTicket((t) => t + 1);
      }
      if (payload.type === "exit") {
        setStatus("completed");
        setSseTicket((t) => t + 1);
        es.close();
      }
      if (payload.type === "error") {
        setStatus("failed");
        setSseTicket((t) => t + 1);
        es.close();
      }
    });

    return () => {
      es.close();
    };
  }, [sessionId, status]);

  return { output, status, error };
}
