import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SuperJSON from "superjson";

import { env } from "~/config/env";
import { authClient } from "~/utils/auth";

import type { ChatMessage, OodaSessionEvent } from "../chat-messages";
import { collapseOodaEventsToMessages } from "../chat-messages";
import { readSseMessages } from "../ooda-sse";
import { slugify } from "../slugify";
import type { AgentChat, AgentChatStatus } from "./use-bob-chat";

interface OodaThread {
  id: string;
  title: string;
  slug: string;
  status: string;
}

interface OodaRunnerDevice {
  id: string;
  name: string;
  status?: string;
  capabilities?: string[];
}

interface OodaRunnerSession {
  id: string;
}

interface OodaSseNotification {
  session_id?: string;
  type?: string;
}

interface OodaClient {
  threads: {
    list: {
      query: () => Promise<unknown>;
    };
    create: {
      mutate: (input: { title: string; slug: string }) => Promise<unknown>;
    };
  };
  runner: {
    listDevices: {
      query: () => Promise<unknown>;
    };
    getSessionEvents: {
      query: (input: { sessionId: string }) => Promise<unknown>;
    };
    sendPrompt: {
      mutate: (input: {
        threadId: string;
        runnerId: string;
        adapterId: string;
        toolProfileId: string;
        prompt: string;
      }) => Promise<unknown>;
    };
    requestPromotion: {
      mutate: (input: {
        sessionId: string;
        runnerId: string;
        threadId: string;
        kind: "observation";
        title: string;
        content: string;
      }) => Promise<unknown>;
    };
  };
}

const DEFAULT_THREAD_TITLE = "Mobile Agent Chat";
const DEFAULT_THREAD_SLUG = "mobile-agent-chat";
const SESSION_STORAGE_KEY = "bob:ooda-session-id";
const THREAD_STORAGE_KEY = "bob:ooda-thread-id";

function createOodaClient(baseUrl: string): OodaClient {
  const client = createTRPCClient<AnyRouter>({
    links: [
      httpBatchLink({
        transformer: SuperJSON,
        url: `${baseUrl.replace(/\/$/, "")}/api/trpc`,
        headers() {
          const headers = new Map<string, string>();
          headers.set("x-trpc-source", "mobile-bob");
          const cookies = authClient.getCookie();
          if (cookies) headers.set("Cookie", cookies);
          return headers;
        },
      }),
    ],
  });

  return client as unknown as OodaClient;
}

function chooseAdapter(device: OodaRunnerDevice | undefined): string {
  const capabilities = device?.capabilities ?? [];
  return capabilities.includes("claude")
    ? "claude"
    : capabilities.includes("codex")
      ? "codex"
      : capabilities[0] ?? "claude";
}

function hasTerminalEvent(events: OodaSessionEvent[] | undefined): boolean {
  return Boolean(
    events?.some((event) => event.type === "exit" || event.type === "error"),
  );
}

async function listOrCreateDefaultThread(
  client: OodaClient,
): Promise<OodaThread[]> {
  const threads = (await client.threads.list.query()) as OodaThread[];
  if (threads.length > 0) return threads;

  try {
    const created = (await client.threads.create.mutate({
      title: DEFAULT_THREAD_TITLE,
      slug: DEFAULT_THREAD_SLUG,
    })) as OodaThread[];
    if (created.length > 0) return created;
  } catch {
    const refreshed = (await client.threads.list.query()) as OodaThread[];
    if (refreshed.length > 0) return refreshed;
    throw new Error("OODA needs an active thread.");
  }

  return [];
}

export interface OodaChatExtensions {
  threads: OodaThread[];
  selectedThreadId: string | null;
  selectThread: (threadId: string) => void;
  createThread: (title: string) => Promise<void>;
}

export function useOodaChat(enabled: boolean): AgentChat & OodaChatExtensions {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [sseTicket, setSseTicket] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);
  const baseUrl = env.oodaApiUrl;
  const client = useMemo(() => createOodaClient(baseUrl), [baseUrl]);

  useEffect(() => {
    if (!enabled) return;
    Promise.all([
      AsyncStorage.getItem(SESSION_STORAGE_KEY),
      AsyncStorage.getItem(THREAD_STORAGE_KEY),
    ])
      .then(([storedSession, storedThread]) => {
        if (storedSession) setActiveSessionId(storedSession);
        if (storedThread) setSelectedThreadId(storedThread);
      })
      .catch((error: unknown) => {
        console.error("[ooda-chat] Failed to restore stored session/thread:", error);
      });
  }, [enabled]);

  const threadsQuery = useQuery({
    queryKey: ["mobile-bob", "ooda", "threads", baseUrl],
    enabled,
    queryFn: () => listOrCreateDefaultThread(client),
  });

  const runnersQuery = useQuery({
    queryKey: ["mobile-bob", "ooda", "runners", baseUrl],
    enabled,
    queryFn: () => client.runner.listDevices.query() as Promise<OodaRunnerDevice[]>,
  });

  const activeThread =
    (selectedThreadId
      ? threadsQuery.data?.find((t) => t.id === selectedThreadId)
      : undefined) ??
    threadsQuery.data?.find((t) => t.status === "active") ??
    threadsQuery.data?.[0];
  const activeRunner = runnersQuery.data?.find((runner) => runner.status === "online") ??
    runnersQuery.data?.[0];

  const eventsQuery = useQuery({
    queryKey: ["mobile-bob", "ooda", "events", activeSessionId],
    enabled: enabled && Boolean(activeSessionId),
    queryFn: () =>
      client.runner.getSessionEvents.query({
        sessionId: activeSessionId ?? "",
      }) as Promise<OodaSessionEvent[]>,
    refetchInterval: (query) =>
      sseConnected || hasTerminalEvent(query.state.data) ? false : 1500,
  });

  useEffect(() => {
    if (sseTicket === 0) return;
    void eventsQuery.refetch();
    // eventsQuery is intentionally omitted because React Query returns a new
    // object frequently; sseTicket is the only refetch trigger here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sseTicket]);

  useEffect(() => {
    if (!enabled || !activeSessionId || hasTerminalEvent(eventsQuery.data)) return;

    const controller = new AbortController();
    let buffer = "";

    async function streamSessionEvents() {
      try {
        const cookies = authClient.getCookie();
        const response = await fetch(
          `${baseUrl.replace(/\/$/, "")}/api/runner/events?sessionId=${encodeURIComponent(activeSessionId ?? "")}`,
          {
            headers: {
              Accept: "text/event-stream",
              ...(cookies ? { Cookie: cookies } : {}),
            },
            signal: controller.signal,
          },
        );

        const body = response.body as ReadableStream<Uint8Array> | null;
        const reader = body?.getReader();
        if (!response.ok || !reader) {
          setSseConnected(false);
          return;
        }

        setSseConnected(true);
        const decoder = new TextDecoder();

        while (!controller.signal.aborted) {
          const readResult = await reader.read();
          if (readResult.done) break;
          const value = readResult.value;
          buffer += decoder.decode(value, { stream: true });
          const result = readSseMessages(buffer);
          buffer = result.rest;

          for (const message of result.messages) {
            if (message.event !== "session_output") continue;

            let payload: OodaSseNotification;
            try {
              payload = JSON.parse(message.data) as OodaSseNotification;
            } catch {
              continue;
            }

            if (payload.session_id !== activeSessionId) continue;
            setSseTicket((ticket) => ticket + 1);

            if (payload.type === "exit" || payload.type === "error") {
              controller.abort();
              break;
            }
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setSseConnected(false);
        }
      }
    }

    void streamSessionEvents();

    return () => {
      controller.abort();
      setSseConnected(false);
    };
  }, [activeSessionId, baseUrl, enabled, eventsQuery.data]);

  const sendMutation = useMutation({
    mutationFn: (text: string) => {
      if (!activeThread?.id || !activeRunner?.id) {
        throw new Error("OODA needs an active thread and runner.");
      }

      return client.runner.sendPrompt.mutate({
        threadId: activeThread.id,
        runnerId: activeRunner.id,
        adapterId: chooseAdapter(activeRunner),
        toolProfileId: "default",
        prompt: text,
      }) as Promise<OodaRunnerSession | null>;
    },
    onSuccess: (session) => {
      if (!session?.id) return;
      setActiveSessionId(session.id);
      void AsyncStorage.setItem(SESSION_STORAGE_KEY, session.id);
      void queryClient.invalidateQueries({
        queryKey: ["mobile-bob", "ooda", "events", session.id],
      });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: (message: ChatMessage) => {
      if (!activeThread?.id || !activeRunner?.id) {
        throw new Error("OODA needs an active thread and runner.");
      }

      let title = message.content.split("\n")[0]?.slice(0, 100).trim();
      if (title === "") title = undefined;
      title ??= "Agent note";

      return client.runner.requestPromotion.mutate({
        sessionId: message.sourceId,
        runnerId: activeRunner.id,
        threadId: activeThread.id,
        kind: "observation",
        title,
        content: message.content,
      });
    },
  });

  const messages = useMemo(
    () =>
      activeSessionId
        ? collapseOodaEventsToMessages(activeSessionId, eventsQuery.data ?? [])
        : [],
    [activeSessionId, eventsQuery.data],
  );

  const send = useCallback((text: string) => {
    sendMutation.mutate(text);
  }, [sendMutation]);

  const promote = useCallback(
    (message: ChatMessage) => {
      promoteMutation.mutate(message);
    },
    [promoteMutation],
  );

  const selectThread = useCallback(
    (threadId: string) => {
      setSelectedThreadId(threadId);
      void AsyncStorage.setItem(THREAD_STORAGE_KEY, threadId);
      setActiveSessionId(null);
      void AsyncStorage.removeItem(SESSION_STORAGE_KEY);
    },
    [],
  );

  const createThread = useCallback(
    async (title: string) => {
      const slug = slugify(title);
      await client.threads.create.mutate({ title, slug });
      await queryClient.invalidateQueries({
        queryKey: ["mobile-bob", "ooda", "threads", baseUrl],
      });
    },
    [baseUrl, client.threads.create, queryClient],
  );

  const status: AgentChatStatus = (() => {
    if (!enabled) return "idle";
    if (threadsQuery.isLoading || runnersQuery.isLoading) return "connecting";
    if (threadsQuery.isError || runnersQuery.isError || sendMutation.isError) {
      return "error";
    }
    if (!activeThread || !activeRunner) return "error";
    return "connected";
  })();

  const isStreaming =
    sendMutation.isPending ||
    (Boolean(activeSessionId) && !hasTerminalEvent(eventsQuery.data));

  return {
    messages,
    send,
    promote,
    isStreaming,
    status,
    statusText:
      status === "connected"
        ? `OODA ${activeThread?.title ?? "thread"} via ${activeRunner?.name ?? "runner"}${sseConnected ? " live" : ""}`
        : !activeThread
          ? "No OODA thread is available"
          : !activeRunner
            ? "No OODA runner is available"
            : "Connecting to OODA",
    threads: threadsQuery.data ?? [],
    selectedThreadId: activeThread?.id ?? null,
    selectThread,
    createThread,
  };
}
