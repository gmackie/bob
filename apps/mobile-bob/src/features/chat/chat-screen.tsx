import type {
  AgentJobV1,
  ContextPackV1,
  MemoryDetailV1,
  MemorySeedV1,
  ProposalV1,
} from "@gmacko/ooda-client/v1";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { v4 as uuidv4 } from "uuid";

import type { OodaMessageTimelineItem } from "./ooda-timeline";
import { Screen } from "~/components/ui";
import { authClient } from "~/utils/auth";
import { ContextInspector } from "./components/context-inspector";
import { ConversationDrawer } from "./components/conversation-drawer";
import { CorrectionEditor } from "./components/correction-editor";
import { JobInspector } from "./components/job-inspector";
import { MemorySearch } from "./components/memory-search";
import { MessageList } from "./components/message-list";
import { ProposalInspector } from "./components/proposal-inspector";
import { VaultBrowser } from "./components/vault-browser";
import { VoiceInputBar } from "./components/voice-input-bar";
import { findLatestContextPackId } from "./context-inspector-model";
import { useOodaConversation } from "./hooks/use-ooda-conversation";
import { useOodaTts } from "./hooks/use-ooda-tts";
import { useVaultBrowser } from "./hooks/use-vault-browser";
import { buildJobCancellation } from "./job-inspector-model";
import { buildMemorySearchInput } from "./memory-search-model";
import { buildProposalDecision } from "./proposal-inspector-model";
import { colors } from "~/lib/colors";

/** Phone entry point — owns its own conversation state. */
export function ChatScreen() {
  const chat = useOodaConversation();
  return <ChatScreenView chat={chat} />;
}

interface ChatScreenViewProps {
  chat: ReturnType<typeof useOodaConversation>;
  /**
   * Tablet split view: the sidebar owns navigation + conversation history,
   * so hide the phone-style Back / History chrome.
   */
  embedded?: boolean;
}

export function ChatScreenView({ chat, embedded = false }: ChatScreenViewProps) {
  const { data: session, isPending } = authClient.useSession();
  const tts = useOodaTts(chat.requestTtsSource);
  const vault = useVaultBrowser();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [vaultVisible, setVaultVisible] = useState(false);
  const [contextVisible, setContextVisible] = useState(false);
  const [contextPack, setContextPack] = useState<ContextPackV1 | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [memoryVisible, setMemoryVisible] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryItems, setMemoryItems] = useState<MemorySeedV1[]>([]);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [isMemoryLoading, setIsMemoryLoading] = useState(false);
  const [hasMemorySearched, setHasMemorySearched] = useState(false);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [memoryDetail, setMemoryDetail] = useState<MemoryDetailV1 | null>(null);
  const [memoryDetailError, setMemoryDetailError] = useState<string | null>(
    null,
  );
  const [isMemoryDetailLoading, setIsMemoryDetailLoading] = useState(false);
  const [memoryFeedbackEdgeId, setMemoryFeedbackEdgeId] = useState<
    string | null
  >(null);
  const [proposalVisible, setProposalVisible] = useState(false);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(
    null,
  );
  const [proposal, setProposal] = useState<ProposalV1 | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [isProposalLoading, setIsProposalLoading] = useState(false);
  const [isProposalDeciding, setIsProposalDeciding] = useState(false);
  const [jobVisible, setJobVisible] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [agentJob, setAgentJob] = useState<AgentJobV1 | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [isJobLoading, setIsJobLoading] = useState(false);
  const [isJobCancelling, setIsJobCancelling] = useState(false);
  const [researchingItemId, setResearchingItemId] = useState<string | null>(
    null,
  );
  const [researchError, setResearchError] = useState<string | null>(null);
  const [correctionItem, setCorrectionItem] =
    useState<OodaMessageTimelineItem | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [isCorrectionSaving, setIsCorrectionSaving] = useState(false);
  const memorySearchRequestRef = useRef(0);
  const memoryDetailRequestRef = useRef(0);
  const proposalRequestRef = useRef(0);
  const jobRequestRef = useRef(0);
  const lastSubmittedAtRef = useRef<number | null>(null);
  const spokenEventIdsRef = useRef(new Set<string>());
  const latestContextPackId = findLatestContextPackId(chat.timeline);
  const getContextPack = chat.getContextPack;
  const searchMemories = chat.searchMemories;
  const inspectMemory = chat.inspectMemory;
  const submitMemoryFeedback = chat.submitMemoryFeedback;
  const getProposal = chat.getProposal;
  const decideProposal = chat.decideProposal;
  const getAgentJob = chat.getAgentJob;
  const cancelAgentJob = chat.cancelAgentJob;

  const startResearch = useCallback(
    async (item: OodaMessageTimelineItem) => {
      setResearchingItemId(item.id);
      setResearchError(null);
      try {
        const result = await chat.createResearchJob(item);
        setSelectedJobId(result.job.id);
        setAgentJob(result.job);
        setJobError(null);
        setIsJobLoading(false);
        setIsJobCancelling(false);
        setJobVisible(true);
      } catch (caught) {
        setResearchError(
          caught instanceof Error ? caught.message : String(caught),
        );
      } finally {
        setResearchingItemId(null);
      }
    },
    [chat],
  );

  const closeCorrection = useCallback(() => {
    if (isCorrectionSaving) return;
    setCorrectionItem(null);
    setCorrectionError(null);
  }, [isCorrectionSaving]);

  const saveCorrection = useCallback(
    async (text: string, reason: string) => {
      const event = correctionItem?.event;
      if (!event) return;
      setCorrectionError(null);
      setIsCorrectionSaving(true);
      try {
        await chat.correctEvent(event, text, reason);
        setCorrectionItem(null);
      } catch (caught) {
        setCorrectionError(
          caught instanceof Error ? caught.message : String(caught),
        );
      } finally {
        setIsCorrectionSaving(false);
      }
    },
    [chat, correctionItem],
  );

  const loadContextPack = useCallback(async () => {
    setContextPack(null);
    setContextError(null);
    if (!latestContextPackId) {
      setIsContextLoading(false);
      return;
    }
    setIsContextLoading(true);
    try {
      setContextPack(await getContextPack(latestContextPackId));
    } catch (caught) {
      setContextError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setIsContextLoading(false);
    }
  }, [getContextPack, latestContextPackId]);

  const openContextInspector = useCallback(() => {
    setContextVisible(true);
    void loadContextPack();
  }, [loadContextPack]);

  const runMemorySearch = useCallback(async () => {
    const requestId = memorySearchRequestRef.current + 1;
    memorySearchRequestRef.current = requestId;
    setMemoryError(null);
    setIsMemoryLoading(true);
    try {
      const page = await searchMemories(buildMemorySearchInput(memoryQuery));
      if (memorySearchRequestRef.current !== requestId) return;
      setMemoryItems(page.items);
      setHasMemorySearched(true);
    } catch (caught) {
      if (memorySearchRequestRef.current !== requestId) return;
      setMemoryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (memorySearchRequestRef.current === requestId) {
        setIsMemoryLoading(false);
      }
    }
  }, [memoryQuery, searchMemories]);

  const openMemorySearch = useCallback(() => {
    setMemoryVisible(true);
    void runMemorySearch();
  }, [runMemorySearch]);

  const openMemoryDetail = useCallback(
    async (memoryId: string) => {
      const requestId = memoryDetailRequestRef.current + 1;
      memoryDetailRequestRef.current = requestId;
      setSelectedMemoryId(memoryId);
      setMemoryDetail(null);
      setMemoryDetailError(null);
      setIsMemoryDetailLoading(true);
      try {
        const nextDetail = await inspectMemory(memoryId);
        if (memoryDetailRequestRef.current !== requestId) return;
        setMemoryDetail(nextDetail);
      } catch (caught) {
        if (memoryDetailRequestRef.current !== requestId) return;
        setMemoryDetailError(
          caught instanceof Error ? caught.message : String(caught),
        );
      } finally {
        if (memoryDetailRequestRef.current === requestId) {
          setIsMemoryDetailLoading(false);
        }
      }
    },
    [inspectMemory],
  );

  const closeMemoryDetail = useCallback(() => {
    memoryDetailRequestRef.current += 1;
    setSelectedMemoryId(null);
    setMemoryDetail(null);
    setMemoryDetailError(null);
  }, []);

  const provideMemoryFeedback = useCallback(
    async (edgeId: string, feedbackState: "confirmed" | "suppressed") => {
      setMemoryFeedbackEdgeId(edgeId);
      setMemoryDetailError(null);
      try {
        const result = await submitMemoryFeedback(edgeId, feedbackState);
        setMemoryDetail((current) =>
          current
            ? {
                ...current,
                connections: current.connections.map((connection) =>
                  connection.edge.id === edgeId
                    ? { ...connection, edge: result.edge }
                    : connection,
                ),
              }
            : current,
        );
      } catch (caught) {
        setMemoryDetailError(
          caught instanceof Error ? caught.message : String(caught),
        );
      } finally {
        setMemoryFeedbackEdgeId(null);
      }
    },
    [submitMemoryFeedback],
  );

  const loadProposal = useCallback(
    async (proposalId: string) => {
      const requestId = proposalRequestRef.current + 1;
      proposalRequestRef.current = requestId;
      setSelectedProposalId(proposalId);
      setProposal(null);
      setProposalError(null);
      setIsProposalLoading(true);
      setIsProposalDeciding(false);
      try {
        const nextProposal = await getProposal(proposalId);
        if (proposalRequestRef.current !== requestId) return;
        setProposal(nextProposal);
      } catch (caught) {
        if (proposalRequestRef.current !== requestId) return;
        setProposalError(
          caught instanceof Error ? caught.message : String(caught),
        );
      } finally {
        if (proposalRequestRef.current === requestId) {
          setIsProposalLoading(false);
        }
      }
    },
    [getProposal],
  );

  const openProposal = useCallback(
    (proposalId: string) => {
      setProposalVisible(true);
      void loadProposal(proposalId);
    },
    [loadProposal],
  );

  const closeProposal = useCallback(() => {
    proposalRequestRef.current += 1;
    setProposalVisible(false);
    setSelectedProposalId(null);
    setProposal(null);
    setProposalError(null);
    setIsProposalDeciding(false);
  }, []);

  const makeProposalDecision = useCallback(
    async (decision: "approve" | "reject") => {
      if (!proposal) return;
      const requestId = proposalRequestRef.current;
      setProposalError(null);
      setIsProposalDeciding(true);
      try {
        const result = await decideProposal(
          buildProposalDecision(proposal, decision),
        );
        if (proposalRequestRef.current !== requestId) return;
        setProposal(result.proposal);
      } catch (caught) {
        if (proposalRequestRef.current !== requestId) return;
        setProposalError(
          caught instanceof Error ? caught.message : String(caught),
        );
      } finally {
        if (proposalRequestRef.current === requestId) {
          setIsProposalDeciding(false);
        }
      }
    },
    [decideProposal, proposal],
  );

  const loadAgentJob = useCallback(
    async (jobId: string) => {
      const requestId = jobRequestRef.current + 1;
      jobRequestRef.current = requestId;
      setSelectedJobId(jobId);
      setAgentJob(null);
      setJobError(null);
      setIsJobLoading(true);
      setIsJobCancelling(false);
      try {
        const nextJob = await getAgentJob(jobId);
        if (jobRequestRef.current !== requestId) return;
        setAgentJob(nextJob);
      } catch (caught) {
        if (jobRequestRef.current !== requestId) return;
        setJobError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (jobRequestRef.current === requestId) setIsJobLoading(false);
      }
    },
    [getAgentJob],
  );

  const openAgentJob = useCallback(
    (jobId: string) => {
      setJobVisible(true);
      void loadAgentJob(jobId);
    },
    [loadAgentJob],
  );

  useEffect(() => {
    if (!jobVisible || !selectedJobId || !agentJob) return;
    const timelineItem = [...chat.timeline]
      .reverse()
      .find((item) => item.kind === "job" && item.jobId === selectedJobId);
    const timelineStatus =
      timelineItem?.kind === "job" ? timelineItem.status : undefined;
    if (timelineStatus && timelineStatus !== agentJob.status) {
      const refresh = setTimeout(() => void loadAgentJob(selectedJobId), 0);
      return () => clearTimeout(refresh);
    }
    return undefined;
  }, [agentJob, chat.timeline, jobVisible, loadAgentJob, selectedJobId]);

  const closeAgentJob = useCallback(() => {
    jobRequestRef.current += 1;
    setJobVisible(false);
    setSelectedJobId(null);
    setAgentJob(null);
    setJobError(null);
    setIsJobCancelling(false);
  }, []);

  const requestAgentJobCancellation = useCallback(async () => {
    if (!agentJob) return;
    const requestId = jobRequestRef.current;
    setJobError(null);
    setIsJobCancelling(true);
    try {
      const result = await cancelAgentJob(
        buildJobCancellation(agentJob, uuidv4()),
      );
      if (jobRequestRef.current !== requestId) return;
      setAgentJob(result.job);
    } catch (caught) {
      if (jobRequestRef.current !== requestId) return;
      setJobError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (jobRequestRef.current === requestId) setIsJobCancelling(false);
    }
  }, [agentJob, cancelAgentJob]);

  const send = chat.send;
  const handleSend = useCallback(
    (text: string) => {
      lastSubmittedAtRef.current = Date.now();
      void send(text);
    },
    [send],
  );

  const playTts = tts.play;
  useEffect(() => {
    lastSubmittedAtRef.current = null;
    spokenEventIdsRef.current.clear();
  }, [chat.selectedConversationId]);

  useEffect(() => {
    const submittedAt = lastSubmittedAtRef.current;
    if (!submittedAt || chat.selectedConversation?.ttsPolicy !== "allowed")
      return;
    const latest = [...chat.timeline]
      .reverse()
      .find(
        (item) =>
          item.kind === "message" &&
          item.role === "assistant" &&
          item.event?.type === "assistant_turn" &&
          Boolean(item.speakable) &&
          new Date(item.timestamp).getTime() >= submittedAt - 5_000 &&
          !spokenEventIdsRef.current.has(item.event.id),
      );
    if (!latest?.event) return;
    spokenEventIdsRef.current.add(latest.event.id);
    void playTts(latest.event.id, "automatic");
  }, [chat.selectedConversation?.ttsPolicy, chat.timeline, playTts]);

  if (isPending || chat.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/" />;

  const activeBranch = chat.branches.find(
    (branch) => branch.id === chat.selectedBranchId,
  );
  const statusColor =
    chat.status === "connected"
      ? "bg-success"
      : chat.status === "error"
        ? "bg-danger"
        : "bg-warning";

  return (
    <Screen className="pt-4">
      <View className="mb-4 flex-row items-center justify-between gap-3">
        {!embedded ? (
          <Pressable onPress={() => router.back()} className="active:opacity-70">
            <Text className="text-muted text-base font-semibold">Back</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => (embedded ? undefined : setDrawerVisible(true))}
          disabled={embedded}
          className={`min-w-0 flex-1 ${embedded ? "items-start" : "items-center"} active:opacity-70`}
        >
          <Text
            className="text-foreground text-lg font-semibold"
            numberOfLines={1}
          >
            {chat.selectedConversation?.title ?? "OODA"}
          </Text>
          {activeBranch && activeBranch.name !== "main" ? (
            <Text className="text-accent text-xs" numberOfLines={1}>
              {activeBranch.name}
            </Text>
          ) : null}
        </Pressable>
        {!embedded ? (
          <Pressable
            onPress={() => setDrawerVisible(true)}
            className="active:opacity-70"
          >
            <Text className="text-accent text-sm font-semibold">History</Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        onPress={() => setDrawerVisible(true)}
        className="bg-card mb-3 flex-row items-center justify-between rounded-xl px-3 py-2 active:opacity-80"
      >
        <View className="flex-row items-center gap-2" style={{ flexShrink: 0 }}>
          <View className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
          <Text
            className="text-xs font-semibold"
            style={{ color: chat.status === "error" ? colors.danger : colors.muted }}
          >
            {chat.status === "error" ? "Connection problem" : chat.status}
          </Text>
        </View>
        <Text
          className="ml-3 flex-1 text-xs"
          style={{ color: chat.status === "error" ? colors.foreground : colors.muted2, minWidth: 0 }}
          numberOfLines={1}
        >
          {chat.statusText}
        </Text>
        {chat.status === "error" ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              void chat.refreshConversations();
            }}
            accessibilityRole="button"
            className="ml-3 rounded-md px-2.5 py-1 active:opacity-70"
            style={{ backgroundColor: colors.danger }}
          >
            <Text className="text-xs font-semibold" style={{ color: colors.white }}>
              Retry
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            setVaultVisible(true);
          }}
          accessibilityRole="button"
          className="ml-3 px-1 py-1 active:opacity-70"
        >
          <Text className="text-xs font-semibold" style={{ color: colors.accent }}>Vault</Text>
        </Pressable>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            openMemorySearch();
          }}
          accessibilityRole="button"
          className="ml-3 px-1 py-1 active:opacity-70"
        >
          <Text className="text-xs font-semibold" style={{ color: colors.accent }}>Memory</Text>
        </Pressable>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            openContextInspector();
          }}
          accessibilityRole="button"
          className="ml-3 px-1 py-1 active:opacity-70"
        >
          <Text className="text-xs font-semibold" style={{ color: colors.accent }}>Context</Text>
        </Pressable>
      </Pressable>

      <View className="min-h-0 flex-1">
        <MessageList
          items={chat.timeline}
          statusText={
            chat.selectedConversation
              ? "Speak or type naturally. Accepted turns are saved before delivery."
              : "Create a new thought to begin your durable conversation history."
          }
          onRetry={(outboxId) => void chat.retry(outboxId)}
          onSpeak={(item) => {
            if (item.event) void tts.play(item.event.id, "manual");
          }}
          canCorrect={chat.canCorrect}
          onCorrect={(item) => {
            setCorrectionError(null);
            setCorrectionItem(item);
          }}
          canResearch={chat.canResearch}
          researchingItemId={researchingItemId}
          onResearch={(item) => void startResearch(item)}
          onOpenProposal={openProposal}
          onOpenJob={openAgentJob}
        />
      </View>

      {researchError ? (
        <View className="border-danger/40 bg-danger/10 mb-2 rounded-xl border px-3 py-2">
          <Text className="text-danger text-xs leading-5">{researchError}</Text>
        </View>
      ) : null}

      {tts.activeEventId ? (
        <View className="border-border bg-card mb-2 flex-row items-center gap-2 rounded-xl border px-3 py-2">
          <Text
            className="text-muted min-w-0 flex-1 text-xs font-semibold"
            numberOfLines={1}
          >
            {tts.error ??
              (tts.isBuffering
                ? "Preparing voice…"
                : tts.isPlaying
                  ? "OODA is speaking"
                  : "Voice ready to replay")}
          </Text>
          {tts.isPlaying || tts.isBuffering ? (
            <Pressable
              onPress={() => void tts.stop()}
              className="active:opacity-70"
            >
              <Text className="text-accent text-xs font-semibold">Stop</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void tts.replay()}
              className="active:opacity-70"
            >
              <Text className="text-accent text-xs font-semibold">Replay</Text>
            </Pressable>
          )}
          <Pressable onPress={tts.cycleRate} className="active:opacity-70">
            <Text className="text-accent text-xs font-semibold">
              {tts.rate}×
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!chat.selectedConversation ? (
        <Pressable
          onPress={() => void chat.createConversation()}
          disabled={!chat.isOnline}
          className="bg-primary mb-3 rounded-2xl py-4 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-primary-foreground text-center font-semibold">
            {chat.isOnline
              ? "Start a new thought"
              : "Connect once to start a conversation"}
          </Text>
        </Pressable>
      ) : (
        <View className="pt-2 pb-3">
          <VoiceInputBar
            onSend={handleSend}
            disabled={!chat.canSend}
            onBargeIn={tts.stop}
          />
        </View>
      )}

      <ConversationDrawer
        visible={drawerVisible}
        conversations={chat.conversations}
        branches={chat.branches}
        selectedConversationId={chat.selectedConversationId}
        selectedBranchId={chat.selectedBranchId}
        pinnedIds={chat.pinnedIds}
        canFork={chat.canFork}
        onClose={() => setDrawerVisible(false)}
        onSelectConversation={chat.openConversation}
        onSelectBranch={chat.selectBranch}
        onCreate={chat.createConversation}
        onFork={chat.forkConversation}
        onTogglePin={chat.togglePin}
      />
      {correctionItem ? (
        <CorrectionEditor
          visible
          originalText={correctionItem.display}
          isSaving={isCorrectionSaving}
          error={correctionError}
          onClose={closeCorrection}
          onSave={(text, reason) => void saveCorrection(text, reason)}
        />
      ) : null}
      <VaultBrowser
        vault={vault}
        visible={vaultVisible}
        onClose={() => setVaultVisible(false)}
      />
      <ContextInspector
        visible={contextVisible}
        expectedPackId={latestContextPackId}
        pack={contextPack}
        isLoading={isContextLoading}
        error={contextError}
        onClose={() => setContextVisible(false)}
        onRetry={() => void loadContextPack()}
      />
      <MemorySearch
        visible={memoryVisible}
        query={memoryQuery}
        items={memoryItems}
        isLoading={isMemoryLoading}
        hasSearched={hasMemorySearched}
        error={memoryError}
        selectedMemoryId={selectedMemoryId}
        detail={memoryDetail}
        detailError={memoryDetailError}
        isDetailLoading={isMemoryDetailLoading}
        feedbackEdgeId={memoryFeedbackEdgeId}
        onQueryChange={setMemoryQuery}
        onSearch={() => void runMemorySearch()}
        onSelectMemory={openMemoryDetail}
        onCloseDetail={closeMemoryDetail}
        onRetryDetail={() => {
          if (selectedMemoryId) void openMemoryDetail(selectedMemoryId);
        }}
        onFeedback={provideMemoryFeedback}
        onClose={() => {
          closeMemoryDetail();
          setMemoryVisible(false);
        }}
      />
      <ProposalInspector
        visible={proposalVisible}
        expectedProposalId={selectedProposalId}
        proposal={proposal}
        rollout={chat.rollout}
        isLoading={isProposalLoading}
        isDeciding={isProposalDeciding}
        error={proposalError}
        onClose={closeProposal}
        onRetry={() => {
          if (selectedProposalId) void loadProposal(selectedProposalId);
        }}
        onDecision={(decision) => void makeProposalDecision(decision)}
      />
      <JobInspector
        visible={jobVisible}
        expectedJobId={selectedJobId}
        job={agentJob}
        isLoading={isJobLoading}
        isCancelling={isJobCancelling}
        error={jobError}
        onClose={closeAgentJob}
        onRetry={() => {
          if (selectedJobId) void loadAgentJob(selectedJobId);
        }}
        onCancel={() => void requestAgentJobCancellation()}
      />
    </Screen>
  );
}
