import type { OodaRolloutPolicyV1, ProposalV1 } from "@gmacko/ooda-client/v1";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { approvalAvailability } from "../proposal-inspector-model";

interface ProposalInspectorProps {
  visible: boolean;
  expectedProposalId: string | null;
  proposal: ProposalV1 | null;
  rollout: OodaRolloutPolicyV1 | null;
  isLoading: boolean;
  isDeciding: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onDecision: (decision: "approve" | "reject") => void;
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "None";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Unavailable";
  }
}

export function ProposalInspector({
  visible,
  expectedProposalId,
  proposal,
  rollout,
  isLoading,
  isDeciding,
  error,
  onClose,
  onRetry,
  onDecision,
}: ProposalInspectorProps) {
  const availability = useMemo(
    () =>
      proposal
        ? approvalAvailability(proposal, rollout)
        : { allowed: false, reason: "Load the proposal before deciding." },
    [proposal, rollout],
  );
  const previewEntries = proposal ? Object.entries(proposal.preview) : [];
  const policyEntries = proposal ? Object.entries(proposal.policySnapshot) : [];
  const canReject = proposal?.status === "awaiting_approval";

  const confirmDecision = (decision: "approve" | "reject") => {
    if (!proposal) return;
    if (decision === "approve") {
      Alert.alert(
        "Approve one delivery?",
        `${proposal.kind.replaceAll("_", " ")} → ${proposal.destination}\nRisk: ${proposal.risk.replaceAll("_", " ")}\n\nThis approval applies to one delivery only and cannot be inherited by later work.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Approve",
            onPress: () => onDecision("approve"),
          },
        ],
      );
      return;
    }
    Alert.alert(
      "Reject proposal?",
      "This stops this proposal from being delivered. The conversation and its memory remain available.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: () => onDecision("reject"),
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="bg-background flex-1 px-5 pt-6">
        <View className="mb-4 flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-foreground text-xl font-semibold">
              Proposal
            </Text>
            <Text className="text-muted mt-0.5 text-xs">
              Inspect the exact destination and payload before committing work.
            </Text>
          </View>
          <Pressable onPress={onClose} className="active:opacity-70">
            <Text className="text-muted text-base font-semibold">Done</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator />
            <Text className="text-muted text-sm">Loading proposal…</Text>
          </View>
        ) : error && !proposal ? (
          <View className="border-border bg-card rounded-xl border px-4 py-4">
            <Text className="text-danger text-sm">{error}</Text>
            <Pressable onPress={onRetry} className="mt-3 active:opacity-70">
              <Text className="text-accent text-sm font-semibold">Retry</Text>
            </Pressable>
          </View>
        ) : proposal ? (
          <>
            <ScrollView
              className="min-h-0 flex-1"
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              <View className="border-border bg-card rounded-xl border px-4 py-4">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="text-accent text-xs font-semibold uppercase">
                    {proposal.kind.replaceAll("_", " ")}
                  </Text>
                  <Text className="text-muted text-xs">
                    {proposal.status.replaceAll("_", " ")}
                  </Text>
                </View>
                <Text className="text-foreground mt-3 text-base font-semibold">
                  {proposal.destination}
                </Text>
                <Text className="text-muted mt-2 text-sm leading-5">
                  {proposal.rationale}
                </Text>
                <View className="mt-3 flex-row items-center justify-between gap-3">
                  <Text className="text-warning text-xs font-semibold">
                    {proposal.risk.replaceAll("_", " ")}
                  </Text>
                  <Text className="text-muted2 text-xs">
                    {Math.round(proposal.confidence * 100)}% confidence · v
                    {proposal.version}
                  </Text>
                </View>
                <Text className="text-muted2 mt-2 text-xs">
                  {proposal.expiresAt
                    ? `Expires ${new Date(proposal.expiresAt).toLocaleString()}`
                    : "No proposal expiry"}
                </Text>
              </View>

              <Text className="text-muted mt-5 mb-2 text-xs font-semibold tracking-wide uppercase">
                Delivery preview
              </Text>
              {previewEntries.length ? (
                <View className="border-border bg-card overflow-hidden rounded-xl border">
                  {previewEntries.map(([key, value], index) => (
                    <View
                      key={key}
                      className={`px-4 py-3 ${
                        index ? "border-border border-t" : ""
                      }`}
                    >
                      <Text className="text-accent text-xs font-semibold">
                        {key}
                      </Text>
                      <Text
                        selectable
                        className="text-foreground mt-1 text-sm leading-5"
                      >
                        {displayValue(value)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text className="text-muted text-sm">
                  This proposal has no preview fields.
                </Text>
              )}

              <Text className="text-muted mt-5 mb-2 text-xs font-semibold tracking-wide uppercase">
                Policy snapshot
              </Text>
              {policyEntries.length ? (
                <View className="border-border bg-card overflow-hidden rounded-xl border">
                  {policyEntries.map(([key, value], index) => (
                    <View
                      key={key}
                      className={`px-4 py-3 ${
                        index ? "border-border border-t" : ""
                      }`}
                    >
                      <Text className="text-accent text-xs font-semibold">
                        {key}
                      </Text>
                      <Text
                        selectable
                        className="text-foreground mt-1 text-sm leading-5"
                      >
                        {displayValue(value)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text className="text-muted text-sm">
                  No additional policy details were captured.
                </Text>
              )}

              <View className="border-border bg-card mt-5 rounded-xl border px-4 py-3">
                <Text className="text-foreground text-sm font-semibold">
                  Single-delivery approval
                </Text>
                <Text className="text-muted mt-1 text-xs leading-5">
                  {availability.reason} Approval never authorizes publishing,
                  deployment, purchases, credentials, or destructive follow-up
                  actions.
                </Text>
                {error ? (
                  <Text className="text-danger mt-2 text-xs">{error}</Text>
                ) : null}
              </View>
            </ScrollView>

            {canReject ? (
              <View className="border-border flex-row gap-3 border-t py-4">
                <Pressable
                  onPress={() => confirmDecision("reject")}
                  disabled={isDeciding}
                  className="border-border bg-card flex-1 rounded-xl border py-3 active:opacity-80 disabled:opacity-40"
                >
                  <Text className="text-danger text-center font-semibold">
                    Reject
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => confirmDecision("approve")}
                  disabled={isDeciding || !availability.allowed}
                  className="bg-primary flex-1 rounded-xl py-3 active:opacity-80 disabled:opacity-40"
                >
                  <Text className="text-primary-foreground text-center font-semibold">
                    {isDeciding ? "Saving…" : "Approve once"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : (
          <View className="border-border bg-card rounded-xl border px-4 py-4">
            <Text className="text-muted text-sm">
              Proposal {expectedProposalId ?? "unknown"} is unavailable.
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
