import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { v4 as uuidv4 } from "uuid";

import type { AgentJobV1, ProposalV1 } from "@gmacko/ooda-client/v1";

import { DiffViewer } from "~/components/tablet/DiffViewer";
import { MarkdownViewer, quoteBlock } from "~/components/markdown";
import type { MarkdownBlock } from "~/components/markdown";
import { EmptyState } from "~/components/ui";
import { buildJobCancellation, jobCancellationAvailability, jobResultPresentation } from "~/features/chat/job-inspector-model";
import { useOodaConversationContext } from "~/features/chat/ooda-conversation-context";
import { approvalAvailability, buildProposalDecision } from "~/features/chat/proposal-inspector-model";
import { colors } from "~/lib/colors";

import { artifactGlyph, artifactKindLabel } from "./types";
import type { ArtifactRef } from "./types";
import { useArtifactStack } from "./use-artifact-stack";

interface ArtifactPaneProps {
  /** Called with a prefilled "> quote" block when the user long-presses a passage. */
  onQuoteReply?: (quoted: string, sourceTitle: string) => void;
  /** Show the in-pane header (back/close). Phone screens pass false and use their own nav. */
  showHeader?: boolean;
  testID?: string;
}

/**
 * Hosts every document type the tablet can open: research reports, plan
 * output, proposals, agent jobs, vault notes, diffs, raw output, links.
 * Reads the top of the shared artifact stack; bodies that need live data
 * (proposal, agent job) load it through the OODA conversation context so
 * there is one client and one session.
 */
export function ArtifactPane({ onQuoteReply, showHeader = true, testID }: ArtifactPaneProps) {
  const { top, stack, back, close } = useArtifactStack();

  if (!top) {
    return (
      <View className="flex-1 items-center justify-center" testID={testID}>
        <EmptyState
          variant="plain"
          title="Nothing open"
          hint="Tap a report, proposal, note, or job in a conversation to read it here."
        />
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }} testID={testID}>
      {showHeader ? (
        <View
          className="flex-row items-center gap-2 px-4"
          style={{ height: 48, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          {stack.length > 1 ? (
            <Pressable
              onPress={back}
              accessibilityRole="button"
              accessibilityLabel="Back to previous document"
              className="rounded-md px-2 py-1 active:opacity-70"
            >
              <Text className="text-sm font-semibold" style={{ color: colors.accent }}>‹ Back</Text>
            </Pressable>
          ) : null}
          <Text className="text-xs font-semibold uppercase" style={{ color: colors.muted, letterSpacing: 0.6 }}>
            {artifactGlyph(top)} {artifactKindLabel(top)}
          </Text>
          <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1} style={{ minWidth: 0 }}>
            {top.title}
          </Text>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close document"
            className="rounded-md px-2 py-1 active:opacity-70"
          >
            <Text className="text-sm" style={{ color: colors.muted }}>Close</Text>
          </Pressable>
        </View>
      ) : null}
      <ArtifactBody artifact={top} onQuoteReply={onQuoteReply} />
    </View>
  );
}

function ArtifactBody({
  artifact,
  onQuoteReply,
}: {
  artifact: ArtifactRef;
  onQuoteReply?: (quoted: string, sourceTitle: string) => void;
}) {
  const handleSelectBlock = useCallback(
    (block: MarkdownBlock) => onQuoteReply?.(quoteBlock(block.text), artifact.title),
    [artifact.title, onQuoteReply],
  );
  const selectBlock = onQuoteReply ? handleSelectBlock : undefined;

  switch (artifact.type) {
    case "research-report":
      return (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
          <MarkdownViewer source={artifact.markdown} onSelectBlock={selectBlock} />
          {artifact.sources && artifact.sources.length > 0 ? (
            <SourcesList sources={artifact.sources} />
          ) : null}
        </ScrollView>
      );
    case "plan-output":
    case "vault-note":
      return (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
          {artifact.type === "vault-note" && artifact.frontmatter ? (
            <Frontmatter entries={artifact.frontmatter} />
          ) : null}
          <MarkdownViewer source={artifact.markdown} onSelectBlock={selectBlock} />
        </ScrollView>
      );
    case "diff":
      return <DiffViewer diff={artifact.content} filePath={artifact.filePath} />;
    case "raw-output":
      return (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          <Text className="text-xs leading-5" style={{ color: colors.secondaryForeground, fontFamily: "Menlo" }} selectable>
            {artifact.content}
          </Text>
        </ScrollView>
      );
    case "web":
      return <WebArtifact url={artifact.url} title={artifact.title} />;
    case "proposal":
      return <ProposalArtifact artifact={artifact} onSelectBlock={selectBlock} />;
    case "agent-job":
      return <AgentJobArtifact artifact={artifact} onSelectBlock={selectBlock} />;
  }
}

function SourcesList({ sources }: { sources: NonNullable<Extract<ArtifactRef, { type: "research-report" }>["sources"]> }) {
  return (
    <View className="mt-6" style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 }}>
      <Text className="mb-2 text-xs font-semibold uppercase" style={{ color: colors.muted, letterSpacing: 0.6 }}>
        Sources
      </Text>
      {sources.map((source, index) => (
        <Pressable
          key={`${source.url}-${index}`}
          onPress={() => void WebBrowser.openBrowserAsync(source.url)}
          accessibilityRole="link"
          className="mb-2 rounded-lg px-3 py-2 active:opacity-80"
          style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
        >
          <Text className="text-sm font-medium" style={{ color: colors.accent }} numberOfLines={1}>
            {index + 1}. {source.title}
          </Text>
          {source.snippet ? (
            <Text className="mt-0.5 text-xs" style={{ color: colors.muted }} numberOfLines={2}>{source.snippet}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function Frontmatter({ entries }: { entries: Record<string, string> }) {
  const rows = Object.entries(entries);
  if (rows.length === 0) return null;
  return (
    <View className="mb-4 rounded-lg px-3 py-2" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
      {rows.map(([key, value]) => (
        <View key={key} className="flex-row gap-3 py-0.5">
          <Text className="text-xs font-semibold" style={{ color: colors.muted, minWidth: 90 }}>{key}</Text>
          <Text className="flex-1 text-xs" style={{ color: colors.secondaryForeground }}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function WebArtifact({ url, title }: { url: string; title: string }) {
  useEffect(() => {
    void WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
  }, [url]);
  return (
    <View className="flex-1 items-center justify-center px-8">
      <EmptyState
        variant="plain"
        title={title}
        hint={url}
        action={
          <Pressable
            onPress={() => void WebBrowser.openBrowserAsync(url)}
            accessibilityRole="link"
            className="rounded-lg px-4 py-2 active:opacity-80"
            style={{ backgroundColor: colors.primary }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primaryForeground }}>Open again</Text>
          </Pressable>
        }
      />
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string | number | undefined }) {
  if (value === undefined || value === "") return null;
  return (
    <View className="flex-row gap-3 py-1">
      <Text className="text-xs font-semibold" style={{ color: colors.muted, minWidth: 96 }}>{label}</Text>
      <Text className="flex-1 text-xs" style={{ color: colors.secondaryForeground }}>{String(value)}</Text>
    </View>
  );
}

function statusColor(status: string | undefined): string {
  switch (status) {
    case "approved":
    case "completed":
    case "delivered":
      return colors.success;
    case "rejected":
    case "failed":
    case "cancelled":
    case "canceled":
      return colors.danger;
    case "pending":
    case "running":
    case "queued":
      return colors.warning;
    default:
      return colors.muted;
  }
}

function ProposalArtifact({
  artifact,
  onSelectBlock,
}: {
  artifact: Extract<ArtifactRef, { type: "proposal" }>;
  onSelectBlock?: (block: MarkdownBlock) => void;
}) {
  const chat = useOodaConversationContext();
  const { update } = useArtifactStack();
  const [proposal, setProposal] = useState<ProposalV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    if (!chat) return;
    setLoading(true);
    setError(null);
    try {
      const next = await chat.getProposal(artifact.proposalId);
      setProposal(next);
      update(artifact.id, { status: next.status });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this proposal.");
    } finally {
      setLoading(false);
    }
  }, [artifact.id, artifact.proposalId, chat, update]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const decide = useCallback(
    (decision: "approve" | "reject") => {
      if (!chat || !proposal) return;
      const run = async () => {
        setDeciding(true);
        try {
          const result = await chat.decideProposal(buildProposalDecision(proposal, decision));
          setProposal(result.proposal);
          update(artifact.id, { status: result.proposal.status });
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Decision failed.");
        } finally {
          setDeciding(false);
        }
      };
      Alert.alert(
        decision === "approve" ? "Approve this proposal?" : "Reject this proposal?",
        decision === "approve"
          ? `It will be delivered to ${proposal.destination}.`
          : "The agent will not deliver it.",
        [
          { text: "Cancel", style: "cancel" },
          { text: decision === "approve" ? "Approve" : "Reject", style: decision === "approve" ? "default" : "destructive", onPress: () => void run() },
        ],
      );
    },
    [artifact.id, chat, proposal, update],
  );

  const availability = proposal ? approvalAvailability(proposal, chat?.rollout ?? null) : { allowed: false, reason: "" };
  const canDecide = availability.allowed && !deciding;
  const body = proposal
    ? `${proposal.rationale}\n\n${Object.entries(proposal.preview)
        .map(([key, value]) => `**${key}**: ${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join("\n\n")}`
    : artifact.rationale ?? artifact.markdown ?? "";

  return (
    <View className="flex-1">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <View className="mb-4 rounded-lg px-3 py-2" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
          <MetaRow label="Status" value={proposal?.status ?? artifact.status} />
          <MetaRow label="Kind" value={proposal?.kind} />
          <MetaRow label="Destination" value={proposal?.destination} />
          <MetaRow label="Risk" value={proposal?.risk} />
          <MetaRow label="Confidence" value={proposal ? `${Math.round(proposal.confidence * 100)}%` : undefined} />
          <MetaRow label="Expires" value={proposal?.expiresAt ? new Date(proposal.expiresAt).toLocaleString() : undefined} />
        </View>
        {error ? (
          <View className="mb-4 rounded-lg px-3 py-2" style={{ backgroundColor: colors.card, borderLeftWidth: 3, borderLeftColor: colors.danger }}>
            <Text className="text-sm" style={{ color: colors.danger }}>{error}</Text>
            <Pressable onPress={() => void load()} className="mt-1 self-start active:opacity-70">
              <Text className="text-xs font-semibold" style={{ color: colors.accent }}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {loading && !proposal ? (
          <Text className="text-sm" style={{ color: colors.muted }}>Loading proposal…</Text>
        ) : (
          <MarkdownViewer source={body} onSelectBlock={onSelectBlock} />
        )}
      </ScrollView>
      <View
        className="flex-row items-center justify-between gap-3 px-4 py-3"
        style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card }}
      >
        <View className="flex-row items-center gap-2">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor(proposal?.status ?? artifact.status) }} />
          <Text className="text-xs font-semibold" style={{ color: colors.muted }} numberOfLines={1}>
            {proposal && !availability.allowed && availability.reason
              ? availability.reason
              : (proposal?.status ?? artifact.status ?? "unknown").replaceAll("_", " ")}
          </Text>
        </View>
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => decide("reject")}
            disabled={!canDecide}
            accessibilityRole="button"
            testID="artifact-proposal-reject"
            className="rounded-lg px-4 py-2 active:opacity-80"
            style={{ borderWidth: 1, borderColor: colors.danger, opacity: canDecide ? 1 : 0.4 }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.danger }}>Reject</Text>
          </Pressable>
          <Pressable
            onPress={() => decide("approve")}
            disabled={!canDecide}
            accessibilityRole="button"
            testID="artifact-proposal-approve"
            className="rounded-lg px-4 py-2 active:opacity-80"
            style={{ backgroundColor: colors.primary, opacity: canDecide ? 1 : 0.4 }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primaryForeground }}>
              {deciding ? "Working…" : "Approve"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function AgentJobArtifact({
  artifact,
  onSelectBlock,
}: {
  artifact: Extract<ArtifactRef, { type: "agent-job" }>;
  onSelectBlock?: (block: MarkdownBlock) => void;
}) {
  const chat = useOodaConversationContext();
  const { update } = useArtifactStack();
  const [job, setJob] = useState<AgentJobV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!chat) return;
    setLoading(true);
    setError(null);
    try {
      const next = await chat.getAgentJob(artifact.jobId);
      setJob(next);
      update(artifact.id, { status: next.status });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this job.");
    } finally {
      setLoading(false);
    }
  }, [artifact.id, artifact.jobId, chat, update]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  // Running jobs: refresh every 5s so findings appear without a manual reload.
  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "queued")) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [job, load]);

  const cancel = useCallback(() => {
    if (!chat || !job) return;
    const run = async () => {
      setCancelling(true);
      try {
        const result = await chat.cancelAgentJob(buildJobCancellation(job, uuidv4()));
        setJob(result.job);
        update(artifact.id, { status: result.job.status });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Cancel failed.");
      } finally {
        setCancelling(false);
      }
    };
    Alert.alert("Cancel this job?", "The agent will stop and partial findings may be lost.", [
      { text: "Keep running", style: "cancel" },
      { text: "Cancel job", style: "destructive", onPress: () => void run() },
    ]);
  }, [artifact.id, chat, job, update]);

  const result = job ? jobResultPresentation(job) : null;
  const findings = result?.response ?? result?.summary ?? artifact.markdown ?? "";
  const cancelAvailability = job ? jobCancellationAvailability(job) : { allowed: false };

  return (
    <View className="flex-1">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <View className="mb-4 rounded-lg px-3 py-2" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
          <MetaRow label="Status" value={(job?.status ?? artifact.status ?? "").replaceAll("_", " ")} />
          <MetaRow label="Class" value={job?.class.replaceAll("_", " ")} />
          <MetaRow label="Provider" value={job?.provider} />
          <MetaRow label="Started" value={job?.startedAt ? new Date(job.startedAt).toLocaleString() : undefined} />
          <MetaRow label="Completed" value={job?.completedAt ? new Date(job.completedAt).toLocaleString() : undefined} />
          {job?.error ? <MetaRow label="Error" value={job.error} /> : null}
        </View>
        {error ? (
          <View className="mb-4 rounded-lg px-3 py-2" style={{ backgroundColor: colors.card, borderLeftWidth: 3, borderLeftColor: colors.danger }}>
            <Text className="text-sm" style={{ color: colors.danger }}>{error}</Text>
            <Pressable onPress={() => void load()} className="mt-1 self-start active:opacity-70">
              <Text className="text-xs font-semibold" style={{ color: colors.accent }}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {loading && !job ? (
          <Text className="text-sm" style={{ color: colors.muted }}>Loading job…</Text>
        ) : findings ? (
          <>
            <Text className="mb-2 text-xs font-semibold uppercase" style={{ color: colors.muted, letterSpacing: 0.6 }}>Findings</Text>
            <MarkdownViewer source={findings} onSelectBlock={onSelectBlock} />
          </>
        ) : (
          <EmptyState
            variant="plain"
            title={job?.status === "running" || job?.status === "queued" ? "Still working" : "No findings yet"}
            hint={job?.status === "running" || job?.status === "queued" ? "Findings appear here as soon as the agent finishes." : "This job produced no written output."}
          />
        )}
        {result?.artifactRef ? (
          <Text className="mt-4 text-xs" style={{ color: colors.muted2 }}>Artifact: {result.artifactRef}</Text>
        ) : null}
      </ScrollView>
      {cancelAvailability.allowed ? (
        <View className="flex-row items-center justify-end px-4 py-3" style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card }}>
          <Pressable
            onPress={cancel}
            disabled={cancelling}
            accessibilityRole="button"
            className="rounded-lg px-4 py-2 active:opacity-80"
            style={{ borderWidth: 1, borderColor: colors.danger, opacity: cancelling ? 0.5 : 1 }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.danger }}>{cancelling ? "Cancelling…" : "Cancel job"}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
