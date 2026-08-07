import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import {
  createOodaV1Client,
} from "@gmacko/ooda-client/v1";
import type {
  ConversationBranchV1,
  ConversationEventV1,
  ConversationV1,
} from "@gmacko/ooda-client/v1";

import { env } from "~/config/env";
import { authClient } from "~/utils/auth";
import { getMobileAuthHeaders } from "~/utils/auth-headers";
import { isDevAuthBypassEnabled } from "~/utils/dev-auth-bypass";

import {
  OodaConversationOutbox,
} from "../ooda-outbox";
import type { OodaOutboxItem } from "../ooda-outbox";
import { buildOodaTimeline } from "../ooda-timeline";

const LAST_CONVERSATION_KEY = "ooda:last-conversation:v1";
const PINNED_CONVERSATIONS_KEY = "ooda:pinned-conversations:v1";

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

function parsePinned(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function useOodaConversation() {
  const client = useMemo(
    () => createOodaV1Client({
      baseUrl: env.oodaApiUrl,
      headers: () => getMobileAuthHeaders(
        authClient.getCookie(),
        isDevAuthBypassEnabled(),
      ),
    }),
    [],
  );
  const outbox = useMemo(
    () => new OodaConversationOutbox({
      storage: AsyncStorage,
      appendEvent: (input) => client.events.append(input),
    }),
    [client],
  );
  const [conversations, setConversations] = useState<ConversationV1[]>([]);
  const [branches, setBranches] = useState<ConversationBranchV1[]>([]);
  const [events, setEvents] = useState<ConversationEventV1[]>([]);
  const [outboxItems, setOutboxItems] = useState<OodaOutboxItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedConversationRef = useRef<string | null>(null);

  const loadAllEvents = useCallback(async (conversationId: string) => {
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
  }, [client]);

  const refreshEvents = useCallback(async (conversationId: string) => {
    try {
      const next = await loadAllEvents(conversationId);
      if (selectedConversationRef.current === conversationId) {
        setEvents((current) => mergeEvents(current, next));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [loadAllEvents]);

  const openConversation = useCallback(async (conversationId: string) => {
    selectedConversationRef.current = conversationId;
    setSelectedConversationId(conversationId);
    setEvents([]);
    setError(null);
    await AsyncStorage.setItem(LAST_CONVERSATION_KEY, conversationId);
    try {
      const [detail, nextEvents] = await Promise.all([
        client.conversations.retrieve(conversationId),
        loadAllEvents(conversationId),
      ]);
      if (selectedConversationRef.current !== conversationId) return;
      setBranches(detail.branches);
      setSelectedBranchId(detail.conversation.activeBranchId);
      setEvents(nextEvents);
    } catch (caught) {
      if (selectedConversationRef.current === conversationId) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
  }, [client, loadAllEvents]);

  const refreshConversations = useCallback(async () => {
    const page = await client.conversations.list({ status: "active", limit: 100 });
    setConversations(page.items);
    return page.items;
  }, [client]);

  const flushOutbox = useCallback(async () => {
    const receipts = await outbox.flush();
    if (receipts.length) {
      setEvents((current) => mergeEvents(
        current,
        receipts.map((receipt) => receipt.result.event),
      ));
      await refreshConversations();
    }
  }, [outbox, refreshConversations]);

  useEffect(() => outbox.subscribe(setOutboxItems), [outbox]);

  useEffect(() => {
    const lifecycle = { cancelled: false };
    void (async () => {
      try {
        const [lastConversationId, rawPins] = await Promise.all([
          AsyncStorage.getItem(LAST_CONVERSATION_KEY),
          AsyncStorage.getItem(PINNED_CONVERSATIONS_KEY),
          outbox.hydrate(),
        ]);
        if (lifecycle.cancelled) return;
        setPinnedIds(parsePinned(rawPins));
        const available = await refreshConversations();
        const initial = available.find((item) => item.id === lastConversationId) ?? available[0];
        if (initial) await openConversation(initial.id);
      } catch (caught) {
        if (!lifecycle.cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!lifecycle.cancelled) setIsLoading(false);
      }
    })();
    return () => {
      lifecycle.cancelled = true;
    };
  }, [openConversation, outbox, refreshConversations]);

  useEffect(() => NetInfo.addEventListener((state) => {
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    setIsOnline(online);
    if (online) {
      void flushOutbox().then(() => {
        const active = selectedConversationRef.current;
        if (active) return refreshEvents(active);
      });
    }
  }), [flushOutbox, refreshEvents]);

  useEffect(() => {
    if (!selectedConversationId || !isOnline) return;
    const timer = setInterval(() => {
      void refreshEvents(selectedConversationId);
    }, 3_000);
    return () => clearInterval(timer);
  }, [isOnline, refreshEvents, selectedConversationId]);

  const createConversation = useCallback(async (title = "New thought") => {
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
  }, [client, openConversation, refreshConversations]);

  const send = useCallback(async (text: string) => {
    const conversation = conversations.find((item) => item.id === selectedConversationRef.current);
    const branchId = selectedBranchId ?? conversation?.activeBranchId;
    const trimmed = text.trim();
    if (!conversation || !branchId || !trimmed) return;
    setError(null);
    await outbox.enqueueTurn({
      conversationId: conversation.id,
      branchId,
      text: trimmed,
    });
    const network = await NetInfo.fetch();
    const online = network.isConnected !== false && network.isInternetReachable !== false;
    setIsOnline(online);
    if (online) await flushOutbox();
  }, [conversations, flushOutbox, outbox, selectedBranchId]);

  const retry = useCallback(async (outboxId: string) => {
    await outbox.retry(outboxId);
    if (isOnline) await flushOutbox();
  }, [flushOutbox, isOnline, outbox]);

  const requestTtsSource = useCallback(async (
    eventId: string,
    requestMode: "automatic" | "manual",
  ) => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) throw new Error("No active conversation");
    const grant = await client.voice.createGrant({
      conversationId,
      eventId,
      requestMode,
      idempotencyKey: uuidv4(),
    });
    return client.voice.audioSource(grant.streamUrl);
  }, [client]);

  const togglePin = useCallback((conversationId: string) => {
    setPinnedIds((current) => {
      const next = current.includes(conversationId)
        ? current.filter((id) => id !== conversationId)
        : [...current, conversationId];
      void AsyncStorage.setItem(PINNED_CONVERSATIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  ) ?? null;
  const selectedOutbox = outboxItems.filter(
    (item) => item.conversationId === selectedConversationId,
  );
  const timeline = useMemo(
    () => buildOodaTimeline(
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
        : "connected";
  const statusText = !isOnline
    ? `${selectedOutbox.length} turn${selectedOutbox.length === 1 ? "" : "s"} queued on this device`
    : error ?? (hasFailures ? "A queued turn needs retry" : selectedConversation?.title ?? "Start a new thought");

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
    isSyncing,
    canSend: Boolean(selectedConversation && selectedBranchId),
    openConversation,
    selectBranch: setSelectedBranchId,
    createConversation,
    refreshConversations,
    send,
    retry,
    requestTtsSource,
    togglePin,
  };
}
