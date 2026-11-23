import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ServerEvent } from "@bob/ws";

import type {
  SessionSummary,
  SummaryAwaitingInput,
  SummarySessionInput,
  SummaryWorkflowState,
} from "./session-summary-model";
import type { GatewaySession } from "~/hooks/use-gateway";
import { rpc } from "~/utils/api";
import { buildSessionSummary } from "./session-summary-model";

/**
 * One summary from three sources, on both form factors.
 *
 * The live event stream and the workspace snapshot come from the gateway
 * socket; they carry status, title and every event. Two reads fill what the
 * socket does not: the session record (its recorded error and identifier when
 * the snapshot does not list it, e.g. a session opened from a push after the
 * snapshot was cut at 200 rows) and the workflow state (the agent's own status
 * message and any question it is waiting on). Both refetch on a slow interval;
 * the gateway invalidates them on every session event anyway.
 */
export function useSessionSummary(input: {
  sessionId: string;
  gatewaySessions: readonly GatewaySession[];
  events: readonly ServerEvent[];
}): {
  summary: SessionSummary;
  resolveAwaitingInput: (value: string) => void;
  isResolvingInput: boolean;
} {
  const { sessionId, gatewaySessions, events } = input;
  const queryClient = useQueryClient();

  const sessionQuery = useQuery(
    rpc("agent.session.get").queryOptions(
      { id: sessionId },
      { enabled: Boolean(sessionId), refetchInterval: 30_000, retry: 1 },
    ),
  );
  const workflowQuery = useQuery(
    rpc("agent.session.getWorkflowState").queryOptions(
      { sessionId },
      { enabled: Boolean(sessionId), refetchInterval: 15_000, retry: 1 },
    ),
  );

  const resolveMutation = useMutation(
    rpc("agent.session.resolveAwaitingInput").mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: rpc("agent.session.getWorkflowState").queryKey({
            sessionId,
          }),
        });
      },
    }),
  );

  const live = gatewaySessions.find(
    (candidate) => candidate.sessionId === sessionId,
  );
  const fetched = sessionQuery.data;
  const workflowData = workflowQuery.data;

  const summary = useMemo(() => {
    const session: SummarySessionInput | null =
      live || fetched
        ? {
            sessionId,
            status: live?.status ?? fetched?.status ?? null,
            title: live?.title ?? fetched?.title ?? null,
            agentType: live?.agentType ?? fetched?.agentType ?? null,
            workItemId: live?.workItemId ?? fetched?.workItemId ?? null,
            workItemIdentifier:
              live?.workItemIdentifier ??
              fetched?.workItemIdentifier ??
              fetched?.workItemIdentifierSnapshot ??
              null,
            lastActivityAt:
              live?.lastActivityAt ??
              (fetched?.lastActivityAt as string | Date | null | undefined) ??
              null,
            lastError: fetched?.lastError ?? null,
          }
        : null;

    const awaiting = workflowData?.awaitingInput;
    const workflowState: SummaryWorkflowState | null = workflowData
      ? {
          workflowStatus: workflowData.workflowStatus,
          statusMessage: workflowData.statusMessage,
          awaitingInput: awaiting
            ? ({
                question: awaiting.question,
                options: awaiting.options,
                defaultAction: awaiting.defaultAction,
                expiresAt: awaiting.expiresAt as string | Date | null,
              } satisfies SummaryAwaitingInput)
            : null,
        }
      : null;

    return buildSessionSummary({ session, sessionId, events, workflowState });
  }, [events, fetched, live, sessionId, workflowData]);

  return {
    summary,
    resolveAwaitingInput: (value: string) =>
      resolveMutation.mutate({
        sessionId,
        resolution: { type: "human", value },
      }),
    isResolvingInput: resolveMutation.isPending,
  };
}
