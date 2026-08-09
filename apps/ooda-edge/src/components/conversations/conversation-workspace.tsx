"use client";

import {
  buildConversationTimelineView,
  createOodaV1Client,
  streamConversationEvents,
  type AgentJobV1,
  type ContextPackV1,
  type ConversationBranchV1,
  type ConversationEventV1,
  type ConversationTimelineItemV1,
  type ConversationV1,
  type DeadLetterV1,
  type IntegrationDeliveryV1,
  type MemorySeedV1,
  type OodaRolloutPolicyV1,
  type ProductionReadinessSnapshotV1,
  type ProposalV1,
} from "@gmacko/ooda-client/v1";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type InspectorTab = "proposals" | "context" | "memory" | "activity";

const LAST_CONVERSATION_KEY = "ooda:web:last-conversation:v1";
const PENDING_NEW_THOUGHT_KEY = "ooda:web:pending-new-thought:v1";

function makeId(): string {
  return globalThis.crypto.randomUUID();
}

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function statusTone(status?: string): string {
  if (!status) return "border-[#34343a] text-[#8A8580]";
  if (
    ["failed", "fail", "dead_letter", "rejected", "timed_out"].includes(status)
  ) {
    return "border-[#C45454]/40 bg-[#C45454]/10 text-[#E68D8D]";
  }
  if (
    ["pass", "delivered", "completed", "approved", "accepted"].includes(status)
  ) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  return "border-[#D4A04A]/30 bg-[#D4A04A]/10 text-[#E0B96E]";
}

export function ConversationWorkspace() {
  const client = useMemo(
    () =>
      createOodaV1Client({
        baseUrl:
          typeof window === "undefined"
            ? "http://localhost"
            : window.location.origin,
      }),
    [],
  );
  const [conversations, setConversations] = useState<ConversationV1[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [branches, setBranches] = useState<ConversationBranchV1[]>([]);
  const [events, setEvents] = useState<ConversationEventV1[]>([]);
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspector, setInspector] = useState<InspectorTab>("proposals");
  const [proposals, setProposals] = useState<ProposalV1[]>([]);
  const [jobs, setJobs] = useState<AgentJobV1[]>([]);
  const [deliveries, setDeliveries] = useState<IntegrationDeliveryV1[]>([]);
  const [deadLetters, setDeadLetters] = useState<DeadLetterV1[]>([]);
  const [contextPack, setContextPack] = useState<ContextPackV1 | null>(null);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memories, setMemories] = useState<MemorySeedV1[]>([]);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rollout, setRollout] = useState<OodaRolloutPolicyV1 | null>(null);
  const [readiness, setReadiness] =
    useState<ProductionReadinessSnapshotV1 | null>(null);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const timeline = useMemo(
    () => buildConversationTimelineView(events),
    [events],
  );
  const latestContextPackId = [...timeline]
    .reverse()
    .find((item) => item.contextPackId)?.contextPackId;

  const loadAllEvents = useCallback(
    async (conversationId: string) => {
      const collected: ConversationEventV1[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const result = await client.events.list({
          conversationId,
          cursor,
          limit: 250,
        });
        collected.push(...result.items);
        if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
        if (result.pageInfo.nextCursor === cursor) break;
        cursor = result.pageInfo.nextCursor;
      }
      return collected;
    },
    [client],
  );

  const refreshConversations = useCallback(async () => {
    const result = await client.conversations.list({
      status: "active",
      limit: 100,
    });
    setConversations(result.items);
    return result.items;
  }, [client]);

  const refreshActivity = useCallback(
    async (conversationId: string) => {
      const [
        proposalPage,
        jobPage,
        deliveryPage,
        deadLetterPage,
        readinessSnapshot,
      ] = await Promise.all([
        client.proposals.list({ conversationId, limit: 100 }),
        client.jobs.list({ conversationId, limit: 100 }),
        client.integrations.listDeliveries({ conversationId, limit: 100 }),
        client.integrations.listDeadLetters({ conversationId, limit: 100 }),
        client.rollout.readiness(),
      ]);
      if (selectedIdRef.current !== conversationId) return;
      setProposals(proposalPage.items);
      setJobs(jobPage.items);
      setDeliveries(deliveryPage.items);
      setDeadLetters(deadLetterPage.items);
      setReadiness(readinessSnapshot);
    },
    [client],
  );

  const openConversation = useCallback(
    async (conversationId: string) => {
      selectedIdRef.current = conversationId;
      setSelectedId(conversationId);
      setEvents([]);
      setContextPack(null);
      setError(null);
      localStorage.setItem(LAST_CONVERSATION_KEY, conversationId);
      window.history.replaceState(
        {},
        "",
        `/conversations?conversation=${conversationId}`,
      );
      try {
        const [detail, nextEvents] = await Promise.all([
          client.conversations.retrieve(conversationId),
          loadAllEvents(conversationId),
        ]);
        if (selectedIdRef.current !== conversationId) return;
        setBranches(detail.branches);
        setEvents(nextEvents);
        await refreshActivity(conversationId);
      } catch (caught) {
        if (selectedIdRef.current === conversationId)
          setError(errorMessage(caught));
      }
    },
    [client, loadAllEvents, refreshActivity],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [rolloutPolicy, readinessSnapshot] = await Promise.all([
          client.rollout.status(),
          client.rollout.readiness(),
        ]);
        if (cancelled) return;
        setRollout(rolloutPolicy);
        setReadiness(readinessSnapshot);
        const search = new URLSearchParams(window.location.search);
        if (search.get("new") === "1") {
          const existingKey = sessionStorage.getItem(PENDING_NEW_THOUGHT_KEY);
          const idempotencyKey = existingKey ?? makeId();
          sessionStorage.setItem(PENDING_NEW_THOUGHT_KEY, idempotencyKey);
          const created = await client.conversations.create({
            title: "New thought",
            hostProvider: "grok",
            hostProfile: "daily",
            sensitivityCeiling: "personal",
            ttsPolicy: "allowed",
            idempotencyKey,
          });
          if (cancelled) return;
          sessionStorage.removeItem(PENDING_NEW_THOUGHT_KEY);
          await refreshConversations();
          await openConversation(created.conversation.id);
          return;
        }
        const available = await refreshConversations();
        if (cancelled) return;
        const requested = search.get("conversation");
        const last = localStorage.getItem(LAST_CONVERSATION_KEY);
        const initial =
          available.find((item) => item.id === requested) ??
          available.find((item) => item.id === last) ??
          available[0];
        if (initial) await openConversation(initial.id);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, openConversation, refreshConversations]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const lastSequence = events.at(-1)?.sequence;
    void streamConversationEvents({
      signal: controller.signal,
      initialAfterSequence: lastSequence,
      createRequest: (afterSequence) =>
        client.events.streamRequest({
          conversationId: selectedId,
          afterSequence,
        }),
      onConnectionChange: setIsConnected,
      onEvent: (event) => {
        if (selectedIdRef.current !== selectedId) return;
        setEvents((current) => mergeEvents(current, [event]));
        if (
          ["proposal", "approval", "delivery", "agent_job_progress"].includes(
            event.type,
          )
        ) {
          void refreshActivity(selectedId);
        }
      },
      onProblem: (problem) => {
        if (selectedIdRef.current === selectedId)
          setError(errorMessage(problem));
      },
    });
    return () => controller.abort();
    // Start a new stream when the selected conversation changes; it resumes
    // from the snapshot loaded by openConversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, refreshActivity, selectedId]);

  useEffect(() => {
    if (inspector !== "context" || !latestContextPackId) return;
    let cancelled = false;
    void client.context
      .get(latestContextPackId)
      .then((pack) => {
        if (!cancelled) setContextPack(pack);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [client, inspector, latestContextPackId]);

  const createConversation = async () => {
    setActionId("new");
    setError(null);
    try {
      const created = await client.conversations.create({
        title: "New thought",
        hostProvider: "grok",
        hostProfile: "daily",
        sensitivityCeiling: "personal",
        ttsPolicy: "allowed",
        idempotencyKey: makeId(),
      });
      await refreshConversations();
      await openConversation(created.conversation.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionId(null);
    }
  };

  const send = async () => {
    const text = composer.trim();
    if (!selected || !text || isSending) return;
    const idempotencyKey = makeId();
    setComposer("");
    setIsSending(true);
    setError(null);
    try {
      const result = await client.events.append({
        conversationId: selected.id,
        branchId: selected.activeBranchId,
        type: "user_turn",
        actor: { type: "user" },
        payload: { display: text, inputMode: "text" },
        sensitivity: "personal",
        correlationId: idempotencyKey,
        idempotencyKey,
        occurredAt: new Date().toISOString(),
      });
      setEvents((current) => mergeEvents(current, [result.event]));
      await client.host.createTurn({
        conversationId: selected.id,
        userEventId: result.event.id,
        idempotencyKey: `${idempotencyKey}:host`,
      });
      await refreshConversations();
    } catch (caught) {
      setComposer(text);
      setError(errorMessage(caught));
    } finally {
      setIsSending(false);
    }
  };

  const decideProposal = async (
    proposal: ProposalV1,
    decision: "approve" | "reject",
  ) => {
    setActionId(proposal.id);
    setError(null);
    try {
      await client.proposals.decide({
        proposalId: proposal.id,
        decision,
        expectedVersion: proposal.version,
        scope: "single_delivery",
        decidedAt: new Date().toISOString(),
      });
      if (selectedId) await refreshActivity(selectedId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionId(null);
    }
  };

  const searchMemories = async () => {
    setActionId("memory-search");
    setError(null);
    try {
      const page = await client.memories.search({
        ...(memoryQuery.trim() ? { query: memoryQuery.trim() } : {}),
        limit: 50,
      });
      setMemories(page.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionId(null);
    }
  };

  const visibleConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#111113] text-[#E8E4DF]">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <aside className="hidden min-h-0 border-r border-[#2A2A2F] bg-[#151517] lg:flex lg:flex-col">
          <ConversationDrawer
            conversations={visibleConversations}
            selectedId={selectedId}
            query={query}
            onQuery={setQuery}
            onOpen={(id) => void openConversation(id)}
            onNew={() => void createConversation()}
            creating={actionId === "new"}
            canCreate={rollout?.capabilities.conversation_write ?? false}
          />
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col">
          <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[#2A2A2F] px-4 md:px-6">
            <div className="min-w-0">
              <p className="truncate font-serif text-lg text-[#E8E4DF]">
                {selected?.title ?? "OODA"}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-[#6F6B67]">
                <span
                  className={`size-1.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-[#6F6B67]"}`}
                />
                {isConnected ? "Live" : "Reconnecting"}
                {branches.length > 1 ? (
                  <span>· {branches.length} branches</span>
                ) : null}
                {selected ? <span>· {selected.hostProvider}</span> : null}
                {rollout ? (
                  <span>· {rollout.stage.replaceAll("_", " ")}</span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void createConversation()}
              disabled={!rollout?.capabilities.conversation_write}
              className="rounded border border-[#D4A04A]/40 px-3 py-1.5 text-xs text-[#D4A04A] lg:hidden"
            >
              New thought
            </button>
          </header>

          {error ? (
            <div
              role="alert"
              className="border-b border-[#C45454]/30 bg-[#C45454]/10 px-4 py-2 text-xs text-[#E68D8D]"
            >
              {error}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 md:px-8">
            <div className="mx-auto max-w-3xl space-y-4">
              {isLoading ? (
                <EmptyTimeline label="Loading conversations…" />
              ) : null}
              {!isLoading && !selected ? (
                <EmptyTimeline label="Begin with a new thought. It stays a possibility until you choose to commit it." />
              ) : null}
              {!isLoading && selected && timeline.length === 0 ? (
                <EmptyTimeline label="Say what is on your mind. OODA will preserve it, recall relevant context, and help decide what deserves action." />
              ) : null}
              {timeline.map((item) => (
                <TimelineCard key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div className="border-t border-[#2A2A2F] bg-[#151517]/95 px-3 py-3 md:px-6">
            <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-[#34343A] bg-[#1A1A1E] p-2 focus-within:border-[#D4A04A]/60">
              <textarea
                aria-label="Message OODA"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                disabled={
                  !selected || isSending || !rollout?.capabilities.mobile_text
                }
                rows={1}
                placeholder={
                  selected
                    ? "Talk through an idea…"
                    : "Create a thought to begin"
                }
                className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[#5A5855] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={
                  !selected ||
                  !composer.trim() ||
                  isSending ||
                  !rollout?.capabilities.mobile_text
                }
                className="rounded-lg bg-[#D4A04A] px-4 py-2.5 text-xs font-semibold text-[#111113] disabled:opacity-30"
              >
                {isSending ? "Queuing…" : "Send"}
              </button>
            </div>
            <p className="mx-auto mt-1.5 max-w-3xl px-1 text-[10px] text-[#5A5855]">
              Durable work and external writes always wait for approval.
            </p>
          </div>
        </section>

        <aside className="hidden min-h-0 border-l border-[#2A2A2F] bg-[#151517] xl:flex xl:flex-col">
          <Inspector
            tab={inspector}
            onTab={setInspector}
            proposals={proposals}
            contextPack={contextPack}
            latestContextPackId={latestContextPackId}
            memoryQuery={memoryQuery}
            onMemoryQuery={setMemoryQuery}
            memories={memories}
            onMemorySearch={() => void searchMemories()}
            jobs={jobs}
            deliveries={deliveries}
            deadLetters={deadLetters}
            readiness={readiness}
            actionId={actionId}
            onDecision={(proposal, decision) =>
              void decideProposal(proposal, decision)
            }
          />
        </aside>
      </div>
    </main>
  );
}

function ConversationDrawer(props: {
  conversations: ConversationV1[];
  selectedId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  creating: boolean;
  canCreate: boolean;
}) {
  return (
    <>
      <div className="border-b border-[#2A2A2F] p-4">
        <div className="flex items-center justify-between">
          <span className="font-serif text-xl text-[#D4A04A]">OODA</span>
          <span className="rounded border border-[#34343A] px-1.5 py-0.5 font-mono text-[9px] text-[#6F6B67]">
            PERSONAL OS
          </span>
        </div>
        <button
          type="button"
          onClick={props.onNew}
          disabled={props.creating || !props.canCreate}
          className="mt-4 w-full rounded-lg bg-[#D4A04A] px-3 py-2.5 text-sm font-semibold text-[#111113] disabled:opacity-50"
        >
          {props.creating ? "Creating…" : "+ New thought"}
        </button>
        <input
          aria-label="Search conversations"
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          placeholder="Search conversations"
          className="mt-3 w-full rounded-lg border border-[#2A2A2F] bg-[#111113] px-3 py-2 text-xs outline-none placeholder:text-[#5A5855] focus:border-[#D4A04A]/50"
        />
      </div>
      <nav
        aria-label="Recent conversations"
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        <p className="px-2 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#5A5855]">
          Recent
        </p>
        {props.conversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            onClick={() => props.onOpen(conversation.id)}
            className={`mb-1 w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
              conversation.id === props.selectedId
                ? "border-[#D4A04A]/25 bg-[#D4A04A]/10"
                : "border-transparent hover:bg-[#1A1A1E]"
            }`}
          >
            <span className="block truncate text-sm text-[#D8D4CF]">
              {conversation.title}
            </span>
            <span className="mt-1 block text-[10px] text-[#5A5855]">
              {formatTime(conversation.updatedAt)}
            </span>
          </button>
        ))}
      </nav>
      <div className="border-t border-[#2A2A2F] p-4 text-[10px] leading-relaxed text-[#5A5855]">
        Capture → enrich → propose → approve → evidence
      </div>
    </>
  );
}

function EmptyTimeline({ label }: { label: string }) {
  return (
    <div className="mx-auto flex min-h-72 max-w-lg items-center justify-center text-center">
      <div>
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full border border-[#D4A04A]/25 bg-[#D4A04A]/5 font-serif text-xl text-[#D4A04A]">
          O
        </div>
        <p className="text-sm leading-relaxed text-[#8A8580]">{label}</p>
      </div>
    </div>
  );
}

function TimelineCard({ item }: { item: ConversationTimelineItemV1 }) {
  if (item.kind === "message") {
    const user = item.role === "user";
    return (
      <article className={`flex ${user ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[88%] rounded-xl border px-4 py-3 ${
            user
              ? "border-[#D4A04A]/25 bg-[#D4A04A]/10"
              : "border-[#2A2A2F] bg-[#1A1A1E]"
          }`}
        >
          <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[#6F6B67]">
            <span>{user ? "You" : "OODA"}</span>
            {item.corrected ? <span>Corrected</span> : null}
            {item.streaming ? (
              <span className="text-[#D4A04A]">Thinking</span>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-[#E8E4DF]">
            {item.body}
          </p>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`rounded-lg border bg-[#151517] p-3 ${item.tone === "error" ? "border-[#C45454]/40" : "border-[#2A2A2F]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#D4A04A]">
            {item.kind}
          </p>
          {item.title ? (
            <p className="mt-1 truncate text-xs font-medium">{item.title}</p>
          ) : null}
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#8A8580]">
            {item.body}
          </p>
        </div>
        {item.status ? <StatusPill status={item.status} /> : null}
      </div>
      {item.href ? (
        <a
          href={item.href}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-[#D4A04A] hover:underline"
        >
          Open evidence ↗
        </a>
      ) : null}
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${statusTone(status)}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function Inspector(props: {
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  proposals: ProposalV1[];
  contextPack: ContextPackV1 | null;
  latestContextPackId?: string;
  memoryQuery: string;
  onMemoryQuery: (value: string) => void;
  memories: MemorySeedV1[];
  onMemorySearch: () => void;
  jobs: AgentJobV1[];
  deliveries: IntegrationDeliveryV1[];
  deadLetters: DeadLetterV1[];
  readiness: ProductionReadinessSnapshotV1 | null;
  actionId: string | null;
  onDecision: (proposal: ProposalV1, decision: "approve" | "reject") => void;
}) {
  const tabs: InspectorTab[] = ["proposals", "context", "memory", "activity"];
  return (
    <>
      <div className="grid grid-cols-4 border-b border-[#2A2A2F]">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => props.onTab(tab)}
            className={`border-b-2 px-1 py-4 text-[10px] capitalize ${props.tab === tab ? "border-[#D4A04A] text-[#D4A04A]" : "border-transparent text-[#6F6B67]"}`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {props.tab === "proposals" ? (
          <div className="space-y-3">
            <InspectorHeading
              title="Commitment gate"
              subtitle="Nothing leaves OODA until you approve the exact preview."
            />
            {props.proposals.length === 0 ? (
              <InspectorEmpty label="No proposals in this conversation." />
            ) : null}
            {props.proposals.map((proposal) => (
              <div
                key={proposal.id}
                className="rounded-lg border border-[#2A2A2F] bg-[#1A1A1E] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">
                    {proposal.kind.replaceAll("_", " ")}
                  </p>
                  <StatusPill status={proposal.status} />
                </div>
                <p className="mt-2 text-xs leading-5 text-[#8A8580]">
                  {proposal.rationale}
                </p>
                <pre className="mt-2 max-h-36 overflow-auto rounded bg-[#111113] p-2 font-mono text-[9px] leading-4 text-[#6F6B67]">
                  {JSON.stringify(proposal.preview, null, 2)}
                </pre>
                {proposal.status === "awaiting_approval" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={props.actionId === proposal.id}
                      onClick={() => props.onDecision(proposal, "reject")}
                      className="rounded border border-[#34343A] px-2 py-1.5 text-[10px] text-[#8A8580] disabled:opacity-40"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={props.actionId === proposal.id}
                      onClick={() => props.onDecision(proposal, "approve")}
                      className="rounded bg-[#D4A04A] px-2 py-1.5 text-[10px] font-semibold text-[#111113] disabled:opacity-40"
                    >
                      Approve once
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {props.tab === "context" ? (
          <div className="space-y-3">
            <InspectorHeading
              title="Disclosure receipt"
              subtitle="The exact context evaluated for the latest host turn."
            />
            {!props.latestContextPackId ? (
              <InspectorEmpty label="No context pack has been recorded yet." />
            ) : null}
            {props.latestContextPackId && !props.contextPack ? (
              <InspectorEmpty label="Loading context receipt…" />
            ) : null}
            {props.contextPack?.items.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-[#2A2A2F] bg-[#1A1A1E] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-wider text-[#8A8580]">
                    {item.sourceType.replaceAll("_", " ")}
                  </p>
                  <StatusPill status={item.decision} />
                </div>
                <p className="mt-2 text-[10px] leading-4 text-[#6F6B67]">
                  {item.reason}
                </p>
                {item.content ? (
                  <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-xs leading-5 text-[#B5B0AA]">
                    {item.content}
                  </p>
                ) : null}
                {item.redaction ? (
                  <p className="mt-2 text-[10px] text-[#E68D8D]">
                    {item.redaction}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {props.tab === "memory" ? (
          <div className="space-y-3">
            <InspectorHeading
              title="Memory search"
              subtitle="Questions and ideas remain discoverable without becoming tasks."
            />
            <div className="flex gap-2">
              <input
                value={props.memoryQuery}
                onChange={(event) => props.onMemoryQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.onMemorySearch();
                }}
                placeholder="Search memory"
                className="min-w-0 flex-1 rounded border border-[#34343A] bg-[#111113] px-2 py-1.5 text-xs outline-none focus:border-[#D4A04A]/50"
              />
              <button
                type="button"
                onClick={props.onMemorySearch}
                disabled={props.actionId === "memory-search"}
                className="rounded bg-[#D4A04A] px-3 text-[10px] font-semibold text-[#111113] disabled:opacity-40"
              >
                Find
              </button>
            </div>
            {props.memories.map((memory) => (
              <div
                key={memory.id}
                className="rounded-lg border border-[#2A2A2F] bg-[#1A1A1E] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-wider text-[#D4A04A]">
                    {memory.kind}
                  </p>
                  <StatusPill status={memory.lifecycleState} />
                </div>
                <p className="mt-2 text-xs leading-5 text-[#B5B0AA]">
                  {memory.normalizedText}
                </p>
                {memory.entities.length ? (
                  <p className="mt-2 truncate text-[9px] text-[#5A5855]">
                    {memory.entities.join(" · ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {props.tab === "activity" ? (
          <div className="space-y-4">
            <InspectorHeading
              title="Execution evidence"
              subtitle="Production gates, research jobs, durable deliveries, and repairable failures."
            />
            <ActivityGroup
              title={
                props.readiness?.ready
                  ? "Production ready"
                  : "Dogfood readiness"
              }
              empty="Readiness has not been evaluated."
              items={
                props.readiness?.gates.map((gate) => ({
                  id: gate.id,
                  title: gate.id.replaceAll("_", " "),
                  status: gate.status,
                  detail: `${gate.observed} · ${gate.requirement}`,
                })) ?? []
              }
            />
            <ActivityGroup
              title="Agent jobs"
              empty="No agent jobs."
              items={props.jobs.map((job) => ({
                id: job.id,
                title: job.class.replaceAll("_", " "),
                status: job.status,
                detail: `${job.provider} · ${job.billingPolicy.replaceAll("_", " ")}`,
              }))}
            />
            <ActivityGroup
              title="Deliveries"
              empty="No external deliveries."
              items={props.deliveries.map((delivery) => ({
                id: delivery.id,
                title: delivery.destination,
                status: delivery.status,
                detail: `${delivery.attemptCount} attempt${delivery.attemptCount === 1 ? "" : "s"}`,
              }))}
            />
            <ActivityGroup
              title="Repair queue"
              empty="No dead letters."
              items={props.deadLetters.map((letter) => ({
                id: letter.id,
                title: "Delivery needs repair",
                status: letter.repairedAt ? "repaired" : "dead_letter",
                detail: letter.reason,
              }))}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function InspectorHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="font-serif text-lg text-[#E8E4DF]">{title}</h2>
      <p className="mt-1 text-[10px] leading-4 text-[#6F6B67]">{subtitle}</p>
    </div>
  );
}

function InspectorEmpty({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-dashed border-[#2A2A2F] px-3 py-6 text-center text-[10px] text-[#5A5855]">
      {label}
    </p>
  );
}

function ActivityGroup(props: {
  title: string;
  empty: string;
  items: { id: string; title: string; status: string; detail: string }[];
}) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#6F6B67]">
        {props.title}
      </h3>
      {props.items.length === 0 ? (
        <InspectorEmpty label={props.empty} />
      ) : (
        <div className="space-y-2">
          {props.items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-[#2A2A2F] bg-[#1A1A1E] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs">{item.title}</p>
                <StatusPill status={item.status} />
              </div>
              <p className="mt-1 text-[10px] leading-4 text-[#6F6B67]">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
