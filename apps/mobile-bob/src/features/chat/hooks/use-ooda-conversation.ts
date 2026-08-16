import type {
  ConversationBranchV1,
  ConversationEventV1,
  ConversationV1,
  MemorySearchInputV1,
  OodaRolloutPolicyV1,
} from "@gmacko/ooda-client/v1";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createOodaV1Client } from "@gmacko/ooda-client/v1";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { v4 as uuidv4 } from "uuid";

import type { OodaOutboxItem } from "../ooda-outbox";
import { env } from "~/config/env";
import { authClient } from "~/utils/auth";
import { getMobileAuthHeaders } from "~/utils/auth-headers";
import { isDevAuthBypassEnabled } from "~/utils/dev-auth-bypass";
import {
  cacheOodaOfflineShell,
  hydrateOodaLocalStartup,
  OODA_PINNED_CONVERSATIONS_STORAGE_KEY,
  rememberOodaConversation,
} from "../ooda-offline-shell";
import { OodaConversationOutbox } from "../ooda-outbox";
import { streamConversationEvents } from "../ooda-sse";
import { buildOodaTimeline } from "../ooda-timeline";

function mergeEvents(
  current: ConversationEventV1[],
  incoming: ConversationEventV1[],
): ConversationEventV1[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => {
    const a = BigInt(left.sequence);
    const b = BigInt(right.sequence);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function useOodaConversation() {
  const client = useMemo(
    () =>
      createOodaV1Client({
        baseUrl: env.oodaApiUrl,
        headers: () =>
          getMobileAuthHeaders(
            authClient.getCookie(),
            isDevAuthBypassEnabled(),
          ),
      }),
    [],
  );
  const outbox = useMemo(
    () =>
      new OodaConversationOutbox({
        storage: AsyncStorage,
        appendEvent: (input) => client.events.append(input),
        completeTurn: (item, result) =>
          client.host
            .createTurn({
              conversationId: item.conversationId,
              userEventId: result.event.id,
              idempotencyKey: `${item.idempotencyKey}:host`,
            })
            .then(() => undefined),
      }),
    [client],
  );
  const [conversations, setConversations] = useState<ConversationV1[]>([]);
  const [branches, setBranches] = useState<ConversationBranchV1[]>([]);
  const [events, setEvents] = useState<ConversationEventV1[]>([]);
  const [outboxItems, setOutboxItems] = useState<OodaOutboxItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollout, setRollout] = useState<OodaRolloutPolicyV1 | null>(null);
  const selectedConversationRef = useRef<string | null>(null);
  const rolloutRef = useRef<OodaRolloutPolicyV1 | null>(null);

  const loadAllEvents = useCallback(
    async (conversationId: string) => {
      const collected: ConversationEventV1[] = [];
      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const page = await client.events.list({
          conversationId,
          cursor,
          limit: 250,
        });
        collected.push(...page.items);
        if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor) break;
        if (page.pageInfo.nextCursor === cursor) break;
        cursor = page.pageInfo.nextCursor;
      }
      return collected;
    },
    [client],
  );

  const refreshEvents = useCallback(
    async (conversationId: string) => {
      try {
        const next = await loadAllEvents(conversationId);
        if (selectedConversationRef.current === conversationId) {
          setEvents((current) => mergeEvents(current, next));
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [loadAllEvents],
  );

  const openConversation = useCallback(
    async (conversationId: string) => {
      selectedConversationRef.current = conversationId;
      setSelectedConversationId(conversationId);
      setEvents([]);
      setError(null);
      await rememberOodaConversation(AsyncStorage, conversationId);
      try {
        const [detail, nextEvents] = await Promise.all([
          client.conversations.retrieve(conversationId),
          loadAllEvents(conversationId),
        ]);
        if (selectedConversationRef.current !== conversationId) return;
        setBranches(detail.branches);
        setSelectedBranchId(detail.conversation.activeBranchId);
        setEvents(nextEvents);
        const currentRollout = rolloutRef.current;
        if (currentRollout) {
          await cacheOodaOfflineShell(AsyncStorage, {
            conversation: detail.conversation,
            branches: detail.branches,
            rollout: currentRollout,
            cachedAt: new Date().toISOString(),
          });
        }
      } catch (caught) {
        if (selectedConversationRef.current === conversationId) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    },
    [client, loadAllEvents],
  );

  const refreshConversations = useCallback(async () => {
    const page = await client.conversations.list({
      status: "active",
      limit: 100,
    });
    setConversations(page.items);
    return page.items;
  }, [client]);

  const flushOutbox = useCallback(async () => {
    const receipts = await outbox.flush();
    if (receipts.length) {
      setEvents((current) =>
        mergeEvents(
          current,
          receipts.map((receipt) => receipt.result.event),
        ),
      );
      await refreshConversations();
      const activeConversationId = selectedConversationRef.current;
      if (activeConversationId) await refreshEvents(activeConversationId);
    }
  }, [outbox, refreshConversations, refreshEvents]);

  useEffect(() => outbox.subscribe(setOutboxItems), [outbox]);

  useEffect(() => {
    const lifecycle = { cancelled: false };
    const isCancelled = () => lifecycle.cancelled;
    void (async () => {
      let hasOfflineShell = false;
      try {
        const local = await hydrateOodaLocalStartup(AsyncStorage, () =>
          outbox.hydrate(),
        );
        if (isCancelled()) return;
        setPinnedIds(local.pinnedIds);
        if (local.shell) {
          hasOfflineShell = true;
          rolloutRef.current = local.shell.rollout;
          setRollout(local.shell.rollout);
          setConversations([local.shell.conversation]);
          setBranches(local.shell.branches);
          selectedConversationRef.current = local.shell.conversation.id;
          setSelectedConversationId(local.shell.conversation.id);
          setSelectedBranchId(local.shell.conversation.activeBranchId);
          // Render the durable local shell immediately. Live rollout and
          // transcript refresh continue below without blocking offline use.
          setIsLoading(false);
        }

        const rolloutPolicy = await client.rollout.status();
        if (isCancelled()) return;
        rolloutRef.current = rolloutPolicy;
        setRollout(rolloutPolicy);
        if (!rolloutPolicy.capabilities.conversation_read) {
          setError(
            rolloutPolicy.reasons[0] ??
              `OODA conversations are not enabled at rollout stage ${rolloutPolicy.stage}.`,
          );
          return;
        }
        const available = await refreshConversations();
        const initial =
          available.find((item) => item.id === local.lastConversationId) ??
          available[0];
        if (initial) await openConversation(initial.id);
      } catch (caught) {
        if (!isCancelled() && !hasOfflineShell)
          setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!isCancelled()) setIsLoading(false);
      }
    })();
    return () => {
      lifecycle.cancelled = true;
    };
  }, [client.rollout, openConversation, outbox, refreshConversations]);

  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        const online =
          state.isConnected !== false && state.isInternetReachable !== false;
        setIsOnline(online);
        if (online) {
          void flushOutbox().then(() => {
            const active = selectedConversationRef.current;
            if (active) return refreshEvents(active);
          });
        }
      }),
    [flushOutbox, refreshEvents],
  );

  useEffect(() => {
    if (!selectedConversationId || !isOnline) {
      return;
    }

    const conversationId = selectedConversationId;
    const controller = new AbortController();
    void streamConversationEvents({
      signal: controller.signal,
      createRequest: (afterSequence) =>
        client.events.streamRequest({
          conversationId,
          afterSequence,
        }),
      onEvent: (event) => {
        if (selectedConversationRef.current !== conversationId) return;
        setEvents((current) => mergeEvents(current, [event]));
      },
      onConnectionChange: (connected) => {
        if (selectedConversationRef.current !== conversationId) return;
        setIsStreamConnected(connected);
        if (connected) setError(null);
      },
      onProblem: (problem) => {
        if (selectedConversationRef.current !== conversationId) return;
        const detail =
          problem && typeof problem === "object" && "detail" in problem
            ? String(problem.detail)
            : problem instanceof Error
              ? problem.message
              : "Live conversation sync is reconnecting.";
        setError(detail);
      },
    });

    return () => {
      controller.abort();
    };
  }, [client, isOnline, selectedConversationId]);

  const createConversation = useCallback(
    async (title = "New thought") => {
      if (!rollout?.capabilities.conversation_write) {
        throw new Error(
          "Creating conversations is not enabled for this rollout stage.",
        );
      }
      setError(null);
      const created = await client.conversations.create({
        title: title.trim() || "New thought",
        hostProvider: "grok",
        hostProfile: "daily",
        sensitivityCeiling: "personal",
        ttsPolicy: "allowed",
        idempotencyKey: uuidv4(),
      });
      await refreshConversations();
      await openConversation(created.conversation.id);
      return created.conversation;
    },
    [client, openConversation, refreshConversations, rollout],
  );

  const send = useCallback(
    async (text: string) => {
      const conversation = conversations.find(
        (item) => item.id === selectedConversationRef.current,
      );
      const branchId = selectedBranchId ?? conversation?.activeBranchId;
      const trimmed = text.trim();
      if (
        !conversation ||
        !branchId ||
        !trimmed ||
        !rollout?.capabilities.mobile_text
      )
        return;
      setError(null);
      await outbox.enqueueTurn({
        conversationId: conversation.id,
        branchId,
        text: trimmed,
      });
      const network = await NetInfo.fetch();
      const online =
        network.isConnected !== false && network.isInternetReachable !== false;
      setIsOnline(online);
      if (online) await flushOutbox();
    },
    [conversations, flushOutbox, outbox, rollout, selectedBranchId],
  );

  const retry = useCallback(
    async (outboxId: string) => {
      await outbox.retry(outboxId);
      if (isOnline) await flushOutbox();
    },
    [flushOutbox, isOnline, outbox],
  );

  const requestTtsSource = useCallback(
    async (eventId: string, requestMode: "automatic" | "manual") => {
      const conversationId = selectedConversationRef.current;
      if (!conversationId) throw new Error("No active conversation");
      if (!rollout?.capabilities.tts) {
        throw new Error(
          "Voice playback is not enabled for this rollout stage.",
        );
      }
      const grant = await client.voice.createGrant({
        conversationId,
        eventId,
        requestMode,
        idempotencyKey: uuidv4(),
      });
      return client.voice.audioSource(grant.streamUrl);
    },
    [client, rollout],
  );

  const getContextPack = useCallback(
    (contextPackId: string) => client.context.get(contextPackId),
    [client],
  );

  const searchMemories = useCallback(
    (input: Partial<MemorySearchInputV1> = {}) => client.memories.search(input),
    [client],
  );

  const inspectMemory = useCallback(
    (memoryId: string) => client.memories.inspect(memoryId),
    [client],
  );

  const submitMemoryFeedback = useCallback(
    (edgeId: string, feedbackState: "confirmed" | "suppressed") =>
      client.memories.feedback({
        edgeId,
        feedbackState,
        idempotencyKey: uuidv4(),
      }),
    [client],
  );

  const togglePin = useCallback((conversationId: string) => {
    setPinnedIds((current) => {
      const next = current.includes(conversationId)
        ? current.filter((id) => id !== conversationId)
        : [...current, conversationId];
      void AsyncStorage.setItem(
        OODA_PINNED_CONVERSATIONS_STORAGE_KEY,
        JSON.stringify(next),
      );
      return next;
    });
  }, []);

  const selectedConversation =
    conversations.find(
      (conversation) => conversation.id === selectedConversationId,
    ) ?? null;
  const selectedOutbox = outboxItems.filter(
    (item) => item.conversationId === selectedConversationId,
  );
  const timeline = useMemo(
    () =>
      buildOodaTimeline(
        events,
        selectedOutbox,
        selectedBranchId && branches.length
          ? { branches, targetBranchId: selectedBranchId }
          : undefined,
      ),
    [branches, events, selectedBranchId, selectedOutbox],
  );
  const isSyncing = selectedOutbox.some((item) => item.status === "syncing");
  const hasFailures = selectedOutbox.some((item) => item.status === "failed");
  const status = !isOnline
    ? "offline"
    : error
      ? "error"
      : isSyncing
        ? "syncing"
        : selectedConversation && !isStreamConnected
          ? "syncing"
          : "connected";
  const statusText = !isOnline
    ? `${selectedOutbox.length} turn${selectedOutbox.length === 1 ? "" : "s"} queued on this device`
    : (error ??
      (hasFailures
        ? "A queued turn needs retry"
        : (selectedConversation?.title ?? "Start a new thought")));

  return {
    conversations,
    branches,
    timeline,
    selectedConversation,
    selectedConversationId,
    selectedBranchId,
    pinnedIds,
    status,
    statusText,
    isLoading,
    isOnline,
    isStreamConnected,
    isSyncing,
    canSend: Boolean(
      selectedConversation &&
      selectedBranchId &&
      rollout?.capabilities.mobile_text,
    ),
    rollout,
    openConversation,
    selectBranch: setSelectedBranchId,
    createConversation,
    refreshConversations,
    send,
    retry,
    getContextPack,
    searchMemories,
    inspectMemory,
    submitMemoryFeedback,
    requestTtsSource,
    togglePin,
  };
}
