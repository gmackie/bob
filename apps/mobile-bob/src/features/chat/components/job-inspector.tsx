import type { AgentJobV1 } from "@gmacko/ooda-client/v1";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  jobCancellationAvailability,
  jobResultPresentation,
} from "../job-inspector-model";

interface JobInspectorProps {
  visible: boolean;
  expectedJobId: string | null;
  job: AgentJobV1 | null;
  isLoading: boolean;
  isCancelling: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

function timestamp(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : "Not yet";
}

export function JobInspector({
  visible,
  expectedJobId,
  job,
  isLoading,
  isCancelling,
  error,
  onClose,
  onRetry,
  onCancel,
}: JobInspectorProps) {
  const cancellation = job
    ? jobCancellationAvailability(job)
    : { allowed: false, reason: "Load the job before cancelling." };
  const result = job ? jobResultPresentation(job) : null;

  const confirmCancellation = () => {
    if (!job || !cancellation.allowed) return;
    Alert.alert(
      "Cancel agent job?",
      "OODA will request cancellation and preserve the original turn, progress, findings, and failure evidence.",
      [
        { text: "Keep running", style: "cancel" },
        { text: "Cancel job", style: "destructive", onPress: onCancel },
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
              Agent job
            </Text>
            <Text className="text-muted mt-0.5 text-xs">
              Inspect runtime scope, budget, and current execution state.
            </Text>
          </View>
          <Pressable onPress={onClose} className="active:opacity-70">
            <Text className="text-muted text-base font-semibold">Done</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator />
            <Text className="text-muted text-sm">Loading agent job…</Text>
          </View>
        ) : error && !job ? (
          <View className="border-border bg-card rounded-xl border px-4 py-4">
            <Text className="text-danger text-sm">{error}</Text>
            <Pressable onPress={onRetry} className="mt-3 active:opacity-70">
              <Text className="text-accent text-sm font-semibold">Retry</Text>
            </Pressable>
          </View>
        ) : job ? (
          <>
            <ScrollView
              className="min-h-0 flex-1"
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              <View className="border-border bg-card rounded-xl border px-4 py-4">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="text-accent text-xs font-semibold uppercase">
                    {job.class.replaceAll("_", " ")}
                  </Text>
                  <Text className="text-muted text-xs">
                    {job.status.replaceAll("_", " ")}
                  </Text>
                </View>
                <Text className="text-foreground mt-3 text-base font-semibold">
                  {job.provider}
                </Text>
                <Text className="text-muted mt-1 text-xs">
                  {job.billingPolicy.replaceAll("_", " ")}
                  {job.authMode
                    ? ` · ${job.authMode.replaceAll("_", " ")}`
                    : ""}
                </Text>
              </View>

              <Text className="text-muted mt-5 mb-2 text-xs font-semibold tracking-wide uppercase">
                Bounded runtime
              </Text>
              <View className="border-border bg-card rounded-xl border px-4 py-3">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="text-muted text-xs">Deadline</Text>
                  <Text className="text-foreground text-sm font-semibold">
                    {Math.round(job.budget.deadlineSeconds / 60)} minutes
                  </Text>
                </View>
                <View className="mt-3 flex-row items-center justify-between gap-3">
                  <Text className="text-muted text-xs">Aggregate budget</Text>
                  <Text className="text-foreground text-sm font-semibold">
                    {job.budget.aggregateTokens.toLocaleString()} tokens
                  </Text>
                </View>
              </View>

              <Text className="text-muted mt-5 mb-2 text-xs font-semibold tracking-wide uppercase">
                Capabilities
              </Text>
              <View className="border-border bg-card rounded-xl border px-4 py-3">
                <Text className="text-foreground text-sm leading-6">
                  {job.capabilities.length
                    ? job.capabilities.join(" · ")
                    : "No capabilities declared"}
                </Text>
                <Text className="text-muted2 mt-2 text-xs">
                  No credentials are inherited by default.
                </Text>
              </View>

              <Text className="text-muted mt-5 mb-2 text-xs font-semibold tracking-wide uppercase">
                Lineage and timing
              </Text>
              <View className="border-border bg-card rounded-xl border px-4 py-3">
                <Text selectable className="text-muted text-xs leading-5">
                  Job: {job.id}
                  {job.contextPackId ? `\nContext: ${job.contextPackId}` : ""}
                  {job.correlationId
                    ? `\nCorrelation: ${job.correlationId}`
                    : ""}
                  {job.runtimeSession
                    ? `\nRuntime: ${job.runtimeSession.sessionId}${
                        job.runtimeSession.turnId
                          ? ` / ${job.runtimeSession.turnId}`
                          : ""
                      }`
                    : ""}
                  {`\nCreated: ${timestamp(job.createdAt)}`}
                  {`\nStarted: ${timestamp(job.startedAt)}`}
                  {`\nCompleted: ${timestamp(job.completedAt)}`}
                </Text>
              </View>

              {job.error ? (
                <View className="border-danger/40 bg-danger/10 mt-5 rounded-xl border px-4 py-3">
                  <Text className="text-danger text-sm leading-5">
                    {job.error}
                  </Text>
                </View>
              ) : null}

              {result ? (
                <View className="border-accent/40 bg-accent/5 mt-5 rounded-xl border px-4 py-4">
                  <Text className="text-accent text-xs font-semibold tracking-wide uppercase">
                    Findings
                  </Text>
                  {result.response || result.summary ? (
                    <Text
                      selectable
                      className="text-foreground mt-3 text-sm leading-6"
                    >
                      {result.response ?? result.summary}
                    </Text>
                  ) : null}
                  {result.artifactRef ? (
                    <Text
                      selectable
                      className="text-muted mt-3 text-xs leading-5"
                    >
                      Artifact: {result.artifactRef}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View className="border-border bg-card mt-5 rounded-xl border px-4 py-3">
                <Text className="text-foreground text-sm font-semibold">
                  Owner control
                </Text>
                <Text className="text-muted mt-1 text-xs leading-5">
                  {cancellation.reason} Job failure or cancellation never
                  removes the source conversation turn.
                </Text>
                {error ? (
                  <Text className="text-danger mt-2 text-xs">{error}</Text>
                ) : null}
                <Pressable
                  onPress={onRetry}
                  className="mt-3 self-start active:opacity-70"
                >
                  <Text className="text-accent text-xs font-semibold">
                    Refresh status
                  </Text>
                </Pressable>
              </View>
            </ScrollView>

            {cancellation.allowed ? (
              <View className="border-border border-t py-4">
                <Pressable
                  onPress={confirmCancellation}
                  disabled={isCancelling}
                  className="border-danger/40 bg-danger/10 rounded-xl border py-3 active:opacity-80 disabled:opacity-40"
                >
                  <Text className="text-danger text-center font-semibold">
                    {isCancelling ? "Requesting…" : "Cancel agent job"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : (
          <View className="border-border bg-card rounded-xl border px-4 py-4">
            <Text className="text-muted text-sm">
              Agent job {expectedJobId ?? "unknown"} is unavailable.
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
