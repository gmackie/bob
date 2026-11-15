import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { safeHref } from "@bob/sdlc-view";

import { displayPending } from "~/features/sdlc/answer-model";
import { bannerFor, itemDetail, shortPlan } from "~/features/sdlc/attention-model";
import { globalDisabledReason, latestFor, outcomeText } from "~/features/sdlc/commands-model";
import { ActionButtons, ATTENTION_COLOR, OfflineBanner, Section } from "~/features/sdlc/components";
import { itemTarget, planTarget } from "~/features/sdlc/confirm-model";
import { AnswerSheet } from "~/features/sdlc/sheets";
import { useNow, useSdlcEdge, useWatchItem } from "~/features/sdlc/use-sdlc-edge";
import { colors } from "~/lib/colors";

const CI_COLOR: Record<string, string> = {
  passed: colors.success,
  failed: colors.danger,
  running: colors.accent,
  queued: colors.muted,
  skipped: colors.muted,
  unknown: colors.muted,
};

/** One SDLC item, list-first: state, pending input, milestones, thread, live tail, CI, actions. */
export default function SdlcItemScreen() {
  const raw = useLocalSearchParams<{ itemId?: string | string[] }>();
  const itemId = (Array.isArray(raw.itemId) ? raw.itemId[0] : raw.itemId) ?? "";
  const { state, send, retry } = useSdlcEdge();
  useWatchItem(itemId || null);
  const now = useNow();
  const [answering, setAnswering] = useState(false);
  const banner = bannerFor(state.view, state.connection, now, state.error);
  const detail = itemDetail(state.view, itemId);
  const ctx = { connection: state.connection, banner, hasView: state.view.epoch !== null, commands: state.commands };
  const attempt = state.attempt?.itemId === itemId ? state.attempt : null;

  if (!detail) {
    return (
      <View className="bg-background flex-1 p-4">
        <Stack.Screen options={{ title: "Item" }} />
        <OfflineBanner banner={banner} now={now} onRetry={retry} />
        <Text className="text-muted text-sm">
          {state.view.epoch === null ? "Waiting for the first snapshot…" : "This item is not in any active plan."}
        </Text>
      </View>
    );
  }

  const pending = detail.row.item.state === "waiting-input" ? (detail.row.item.pendingInput ?? null) : null;
  const latest = latestFor(state.commands, itemId);
  const issueUrl = safeHref(detail.row.issue.url);
  const ci = attempt?.ci ?? null;

  return (
    <>
      <Stack.Screen options={{ title: detail.title }} />
      <ScrollView className="bg-background flex-1" contentContainerClassName="p-4 pb-12" testID="sdlc-item">
        <OfflineBanner banner={banner} now={now} onRetry={retry} />

        <Text className="text-xs font-semibold uppercase" style={{ color: ATTENTION_COLOR[detail.attention] }}>{detail.stateLabel}</Text>
        <Text className="text-foreground mt-1 text-xl font-semibold">{detail.title}</Text>
        {detail.hint ? <Text className="text-muted mt-1 text-sm">{detail.hint}</Text> : null}
        <Pressable onPress={() => router.push(detail.planHref)} accessibilityRole="link" className="mt-2">
          <Text className="text-accent text-xs font-semibold">
            {detail.row.startupName} · {detail.row.target.repository.repositoryId} · plan {shortPlan(detail.row.plan.planId)} ›
          </Text>
        </Pressable>
        {issueUrl ? (
          <Pressable onPress={() => void Linking.openURL(issueUrl)} accessibilityRole="link" className="mt-1">
            <Text className="text-accent text-xs">Open issue ↗</Text>
          </Pressable>
        ) : null}

        {pending ? (
          <Section title="Waiting for your answer">
            <View className="rounded-2xl px-4 py-3" style={{ backgroundColor: colors.card, borderColor: colors.accent, borderWidth: 1 }}>
              {displayPending(pending).questions.map((q) => (
                <Text key={q.id} className="text-foreground mb-1 text-sm">• {q.question}</Text>
              ))}
              <Pressable
                testID="sdlc-answer-open"
                onPress={() => setAnswering(true)}
                accessibilityRole="button"
                className="bg-primary mt-3 h-11 items-center justify-center rounded-xl active:opacity-80"
              >
                <Text className="text-primary-foreground font-semibold">Answer</Text>
              </Pressable>
            </View>
          </Section>
        ) : null}

        <Section title="Milestones">
          <View className="flex-row flex-wrap gap-2">
            {detail.milestones.map((m) => (
              <View key={m.key} className="rounded-full border px-2.5 py-1" style={{ borderColor: m.achieved ? colors.success : colors.border }}>
                <Text className="text-xs" style={{ color: m.achieved ? colors.success : colors.muted }}>{m.label}</Text>
              </View>
            ))}
          </View>
        </Section>

        {detail.thread ? (
          <Section title="Thread">
            <Text selectable className="text-secondary-foreground text-xs">thread {detail.thread.threadId}</Text>
            <Text selectable className="text-muted text-xs">attempt {detail.thread.attemptId}</Text>
            <Text selectable className="text-muted text-xs">env {detail.thread.environmentId} · project {detail.thread.projectId}</Text>
          </Section>
        ) : null}

        <Section title={attempt?.tail ? `Live tail · ${attempt.tail.threadStatus}` : "Live tail"}>
          {attempt?.tail ? (
            <View className="rounded-xl px-3 py-2" style={{ backgroundColor: colors.card }}>
              {attempt.tail.lines.map((line, i) => (
                <Text key={i} className="text-secondary-foreground font-mono text-[11px]">{line}</Text>
              ))}
            </View>
          ) : (
            <Text className="text-muted text-xs">{attempt?.tailUnavailable ?? "No live output for this attempt."}</Text>
          )}
        </Section>

        <Section title="CI">
          {ci?.available ? (
            <View>
              <Text className="text-secondary-foreground mb-2 text-xs">{ci.summary} · {ci.sha.slice(0, 8)}</Text>
              {ci.phases.map((phase) => {
                const href = safeHref(phase.url);
                return (
                  <Pressable
                    key={phase.name}
                    disabled={!href}
                    onPress={() => href && void Linking.openURL(href)}
                    className="mb-1 flex-row items-center justify-between"
                  >
                    <Text className="text-foreground text-sm">{phase.name}</Text>
                    <Text className="text-xs font-semibold" style={{ color: CI_COLOR[phase.status] ?? colors.muted }}>{phase.status}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text className="text-muted text-xs">{ci?.available === false ? ci.reason : "No CI detail yet."}</Text>
          )}
        </Section>

        <Section title="Actions">
          <ActionButtons
            options={detail.actions}
            target={itemTarget(detail.title, detail.row.plan.planId)}
            ctx={ctx}
            send={(option, confirm) => send(option.command, option.label, confirm)}
          />
          {detail.actions.length === 0 && latest ? <Text className="text-secondary-foreground text-xs">{outcomeText(latest)}</Text> : null}
          {detail.actions.length === 0 && !latest ? <Text className="text-muted text-xs">No item actions in this state.</Text> : null}
        </Section>

        <Section title="Plan">
          <ActionButtons
            options={detail.planActions}
            target={planTarget(detail.row.plan.planId)}
            ctx={ctx}
            send={(option, confirm) => send(option.command, option.label, confirm)}
          />
        </Section>
      </ScrollView>

      <AnswerSheet
        itemId={itemId}
        title={detail.title}
        pending={pending}
        visible={answering}
        disabledReason={globalDisabledReason(ctx)}
        onClose={() => setAnswering(false)}
        onSend={(command) => {
          send(command, "Answer");
          setAnswering(false);
        }}
      />
    </>
  );
}
