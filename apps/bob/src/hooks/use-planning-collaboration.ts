"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ServerArtifactUpdated,
  ServerCollabChatMessage,
  ServerPresenceChanged,
  ServerPresenceSnapshot,
  SessionPresenceParticipant,
} from "@bob/ws";

import { useTRPC } from "~/trpc/react";

export type PlanningPresence = SessionPresenceParticipant;

export interface PlanningCollabMessage {
  id?: string;
  clientMessageId?: string | null;
  userId: string;
  displayName: string;
  imageUrl?: string | null;
  body: string;
  createdAt: string;
}

function messageKey(msg: PlanningCollabMessage): string {
  return msg.id ?? msg.clientMessageId ?? `${msg.userId}:${msg.createdAt}:${msg.body}`;
}

interface UsePlanningCollaborationOptions {
  sessionId: string;
  enabled?: boolean;
  displayName?: string;
  imageUrl?: string | null;
}

/**
 * Live presence + human collab chat + shared artifact update fan-out for
 * planning sessions (BOB-14). Uses the same WS gateway as agent streaming.
 */
export function usePlanningCollaboration({
  sessionId,
  enabled = true,
  displayName,
  imageUrl,
}: UsePlanningCollaborationOptions) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [participants, setParticipants] = useState<PlanningPresence[]>([]);
  const [liveMessages, setLiveMessages] = useState<PlanningCollabMessage[]>([]);
  const [liveArtifact, setLiveArtifact] = useState<ServerArtifactUpdated | null>(
    null,
  );

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined, {
      enabled: enabled && Boolean(sessionId),
    }),
  );
  const resolvedGatewayUrl = gatewayInfo?.url ?? "";
  const resolvedToken = gatewayInfo?.token ?? "";

  const messagesQuery = useQuery({
    ...trpc.planSession.listMessages.queryOptions({ sessionId }),
    enabled: enabled && Boolean(sessionId),
    refetchOnWindowFocus: false,
  });

  const historyMessages: PlanningCollabMessage[] = useMemo(() => {
    const rows = messagesQuery.data ?? [];
    return rows.map((row) => ({
      id: row.id,
      clientMessageId: row.clientMessageId,
      userId: row.userId,
      displayName: row.userName ?? row.userId,
      imageUrl: row.userImage,
      body: row.body,
      createdAt: row.createdAt,
    }));
  }, [messagesQuery.data]);

  const messages = useMemo(() => {
    const byKey = new Map<string, PlanningCollabMessage>();
    for (const msg of historyMessages) {
      byKey.set(messageKey(msg), msg);
    }
    for (const msg of liveMessages) {
      byKey.set(messageKey(msg), msg);
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }, [historyMessages, liveMessages]);

  const applyPresenceSnapshot = useCallback((snap: ServerPresenceSnapshot) => {
    if (snap.sessionId !== sessionId) return;
    setParticipants(snap.participants);
  }, [sessionId]);

  const applyPresenceChanged = useCallback((change: ServerPresenceChanged) => {
    if (change.sessionId !== sessionId) return;
    setParticipants((prev) => {
      const without = prev.filter(
        (p) =>
          !(
            p.userId === change.participant.userId &&
            p.clientId === change.participant.clientId
          ),
      );
      if (change.change === "leave") return without;
      return [...without, change.participant];
    });
  }, [sessionId]);

  const applyCollabChat = useCallback((msg: ServerCollabChatMessage) => {
    if (msg.sessionId !== sessionId) return;
    setLiveMessages((prev) => {
      const next: PlanningCollabMessage = {
        id: msg.message.id,
        clientMessageId: msg.message.clientMessageId,
        userId: msg.message.userId,
        displayName: msg.message.displayName,
        imageUrl: msg.message.imageUrl,
        body: msg.message.body,
        createdAt: msg.message.createdAt,
      };
      const key = messageKey(next);
      if (prev.some((p) => messageKey(p) === key)) return prev;
      return [...prev, next];
    });
  }, [sessionId]);

  const applyArtifactUpdated = useCallback((msg: ServerArtifactUpdated) => {
    if (msg.sessionId !== sessionId) return;
    setLiveArtifact(msg);
    void queryClient.invalidateQueries({
      queryKey: trpc.planSession.listArtifacts.queryKey({ sessionId }),
    });
  }, [queryClient, sessionId, trpc.planSession.listArtifacts]);

  const collabClientRef = useRef<import("@bob/ws").BobWsClient | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    if (!enabled || !resolvedGatewayUrl || !resolvedToken || !sessionId) {
      setWsConnected(false);
      return;
    }

    let cancelled = false;
    void import("@bob/ws").then(({ BobWsClient }) => {
      if (cancelled) return;
      const clientId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `collab-${Date.now()}`;
      const client = new BobWsClient({
        url: resolvedGatewayUrl,
        token: resolvedToken,
        clientId,
        deviceType: "web",
        onEvent: () => {},
        onSessionStatus: () => {},
        onPresenceSnapshot: applyPresenceSnapshot,
        onPresenceChanged: applyPresenceChanged,
        onCollabChatMessage: applyCollabChat,
        onArtifactUpdated: applyArtifactUpdated,
        onError: () => {},
        onConnectionStateChange: (state) => {
          setWsConnected(state === "connected");
          if (state === "connected") {
            // Full subscribe (not observe-only) so collaborators can share input.
            client.subscribe(sessionId, 0);
            client.updatePresence(sessionId, {
              focus: "chat",
              displayName,
              imageUrl,
            });
          }
        },
      });
      collabClientRef.current = client;
      client.connect();
    });

    return () => {
      cancelled = true;
      collabClientRef.current?.unsubscribe(sessionId);
      collabClientRef.current?.disconnect();
      collabClientRef.current = null;
      setWsConnected(false);
    };
  }, [
    applyArtifactUpdated,
    applyCollabChat,
    applyPresenceChanged,
    applyPresenceSnapshot,
    displayName,
    enabled,
    imageUrl,
    resolvedGatewayUrl,
    resolvedToken,
    sessionId,
  ]);

  const sendMessageMutation = useMutation(
    trpc.planSession.sendMessage.mutationOptions({
      onSuccess: (result) => {
        setLiveMessages((prev) => {
          const next: PlanningCollabMessage = {
            id: result.id,
            clientMessageId: result.clientMessageId,
            userId: result.userId,
            displayName: result.userName ?? result.userId,
            imageUrl: result.userImage,
            body: result.body,
            createdAt: result.createdAt,
          };
          const key = messageKey(next);
          if (prev.some((p) => messageKey(p) === key)) return prev;
          return [...prev, next];
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.planSession.listMessages.queryKey({ sessionId }),
        });
      },
    }),
  );

  const sendCollabMessage = useCallback(
    async (body: string) => {
      const clientMessageId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `m-${Date.now()}`;
      const optimistic: PlanningCollabMessage = {
        clientMessageId,
        userId: "me",
        displayName: displayName ?? "You",
        imageUrl,
        body,
        createdAt: new Date().toISOString(),
      };
      setLiveMessages((prev) => [...prev, optimistic]);
      collabClientRef.current?.sendCollabChat(sessionId, body, clientMessageId, {
        displayName,
        imageUrl,
      });
      await sendMessageMutation.mutateAsync({
        sessionId,
        body,
        clientMessageId,
      });
    },
    [displayName, imageUrl, sendMessageMutation, sessionId],
  );

  const setFocus = useCallback(
    (focus: PlanningPresence["focus"], artifactId?: string | null) => {
      collabClientRef.current?.updatePresence(sessionId, {
        focus,
        artifactId,
        displayName,
        imageUrl,
      });
    },
    [displayName, imageUrl, sessionId],
  );

  // Dedupe participants by userId for avatar display (multi-tab collapses)
  const uniqueParticipants = useMemo(() => {
    const byUser = new Map<string, PlanningPresence>();
    for (const p of participants) {
      const existing = byUser.get(p.userId);
      if (!existing || p.lastSeenAt > existing.lastSeenAt) {
        byUser.set(p.userId, p);
      }
    }
    return Array.from(byUser.values());
  }, [participants]);

  return {
    participants: uniqueParticipants,
    messages,
    liveArtifact,
    isConnected: wsConnected,
    isLoadingMessages: messagesQuery.isLoading,
    sendCollabMessage,
    setFocus,
    isSending: sendMessageMutation.isPending,
  };
}
