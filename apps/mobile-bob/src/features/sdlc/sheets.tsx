// The SDLC confirmation and answer sheets. Plain RN Modals, like the chat inspectors:
// no new native modules (this ships as an EAS update).
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { CommandOption, Confirmation, PendingInput } from "@bob/sdlc-view";

import { colors } from "~/lib/colors";
import {
  displayPending,
  emptyDraft,
  optionValue,
  resolveCommand,
  setText,
  toggleOption,
  unansweredCount,
} from "./answer-model";
import type {AnswerDraft} from "./answer-model";
import { confirmationFor, confirmPrompt } from "./confirm-model";

function buzz(kind: "success" | "warning") {
  try {
    void Haptics.notificationAsync(
      kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    );
  } catch {
    // Haptics are a nicety.
  }
}

function SheetFrame({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/60" onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <View className="rounded-t-3xl px-5 pt-4 pb-10" style={{ backgroundColor: colors.card }}>
          <View className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ backgroundColor: colors.border }} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Tier 2: an explicit confirm. Tier 3: the expected text typed exactly. Renders nothing
 * for tier 1 (the caller sends those at once).
 */
export function ConfirmSheet({
  option,
  target,
  onConfirm,
  onCancel,
}: {
  option: CommandOption | null;
  target: string;
  onConfirm: (option: CommandOption, confirm: Confirmation | undefined) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const prompt = option ? confirmPrompt(option, target) : null;
  const confirm = option ? confirmationFor(option, typed) : null;
  const close = () => { setTyped(""); onCancel(); };
  return (
    <SheetFrame visible={!!prompt} onClose={close}>
      {prompt && option ? (
        <View testID="sdlc-confirm-sheet">
          <Text className="text-foreground text-lg font-semibold">{prompt.title}</Text>
          <Text className="text-muted mt-1 text-sm">{prompt.body}</Text>
          {prompt.expected !== null ? (
            <View className="mt-4">
              <Text className="text-secondary-foreground text-xs">
                Type <Text className="text-foreground font-semibold">{prompt.expected}</Text> to confirm.
              </Text>
              <TextInput
                testID="sdlc-confirm-typed"
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="none"
                autoCorrect={false}
                className="text-foreground border-border mt-2 rounded-xl border px-3 py-3"
                placeholderTextColor={colors.muted}
                placeholder={prompt.expected}
              />
            </View>
          ) : null}
          <View className="mt-5 flex-row gap-3">
            <Pressable onPress={close} className="border-border h-12 flex-1 items-center justify-center rounded-xl border active:opacity-70" accessibilityRole="button">
              <Text className="text-foreground font-semibold">Keep it</Text>
            </Pressable>
            <Pressable
              testID="sdlc-confirm-button"
              disabled={confirm === null}
              onPress={() => {
                if (confirm === null) return;
                buzz(prompt.destructive ? "warning" : "success");
                setTyped("");
                onConfirm(option, confirm);
              }}
              accessibilityRole="button"
              accessibilityState={{ disabled: confirm === null }}
              className={`h-12 flex-1 items-center justify-center rounded-xl ${confirm === null ? "opacity-40" : "active:opacity-80"}`}
              style={{ backgroundColor: prompt.destructive ? colors.danger : colors.primary }}
            >
              <Text className="font-semibold" style={{ color: prompt.destructive ? colors.white : colors.primaryForeground }}>
                {prompt.confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SheetFrame>
  );
}

/** Answers an item's pending input: single or multi select options, or free text. */
export function AnswerSheet({
  itemId,
  title,
  pending,
  visible,
  disabledReason,
  onSend,
  onClose,
}: {
  itemId: string;
  title: string;
  pending: PendingInput | null;
  visible: boolean;
  disabledReason: string | null;
  onSend: (command: NonNullable<ReturnType<typeof resolveCommand>>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<{ promptId: string; value: AnswerDraft } | null>(null);
  // A new prompt (the agent asked again) starts a fresh draft.
  const current = pending && draft?.promptId === pending.promptId ? draft.value : pending ? emptyDraft(pending) : {};
  const update = (value: AnswerDraft) => pending && setDraft({ promptId: pending.promptId, value });
  const command = pending ? resolveCommand(itemId, pending, current) : null;
  const remaining = pending ? unansweredCount(pending, current) : 0;
  const blocked = disabledReason ?? (command ? null : `${remaining} question${remaining === 1 ? "" : "s"} still need an answer.`);

  return (
    <SheetFrame visible={visible && !!pending} onClose={onClose}>
      {pending ? (
        <View testID="sdlc-answer-sheet" style={{ maxHeight: 620 }}>
          <Text className="text-foreground text-lg font-semibold">Answer {title}</Text>
          <ScrollView className="mt-3" keyboardShouldPersistTaps="handled">
            {pending.questions.map((q, qi) => {
              const d = current[q.id] ?? { selected: [], text: "" };
              // Shown text is stripped of terminal controls; values and toggles use the original.
              const shown = displayPending(pending).questions[qi] ?? q;
              return (
                <View key={q.id} className="mb-5">
                  {shown.header ? <Text className="text-muted text-xs uppercase">{shown.header}</Text> : null}
                  <Text className="text-foreground mt-1 text-base">{shown.question}</Text>
                  {q.options.length > 0 ? (
                    <View className="mt-2 gap-2">
                      {q.multiSelect ? <Text className="text-muted text-xs">Choose any</Text> : null}
                      {q.options.map((o, oi) => {
                        const value = optionValue(o);
                        const label = shown.options[oi] ?? o;
                        const on = d.selected.includes(value);
                        return (
                          <Pressable
                            key={value}
                            onPress={() => update(toggleOption(current, q, value))}
                            accessibilityRole={q.multiSelect ? "checkbox" : "radio"}
                            accessibilityState={{ checked: on }}
                            className="rounded-xl border px-3 py-3 active:opacity-70"
                            style={{ borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.cardElevated : colors.background }}
                          >
                            <Text className="font-semibold" style={{ color: on ? colors.accent : colors.foreground }}>
                              {q.multiSelect ? (on ? "☑ " : "☐ ") : on ? "● " : "○ "}
                              {label.label}
                            </Text>
                            {label.description ? <Text className="text-muted mt-0.5 text-xs">{label.description}</Text> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <TextInput
                      value={d.text}
                      onChangeText={(text) => update(setText(current, q.id, text))}
                      multiline
                      placeholder="Your answer"
                      placeholderTextColor={colors.muted}
                      className="text-foreground border-border mt-2 min-h-20 rounded-xl border px-3 py-3"
                    />
                  )}
                </View>
              );
            })}
          </ScrollView>
          {blocked ? <Text className="text-muted mb-2 text-xs">{blocked}</Text> : null}
          <Pressable
            testID="sdlc-answer-send"
            disabled={!command || !!disabledReason}
            onPress={() => {
              if (!command || disabledReason) return;
              buzz("success");
              onSend(command);
            }}
            accessibilityRole="button"
            className={`bg-primary h-12 items-center justify-center rounded-xl ${!command || disabledReason ? "opacity-40" : "active:opacity-80"}`}
          >
            <Text className="text-primary-foreground font-semibold">Send answer</Text>
          </Pressable>
        </View>
      ) : null}
    </SheetFrame>
  );
}
