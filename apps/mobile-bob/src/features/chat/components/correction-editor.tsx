import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors } from "~/lib/colors";

interface CorrectionEditorProps {
  visible: boolean;
  originalText: string;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (text: string, reason: string) => void;
}

const DEFAULT_REASON = "Corrected saved turn from mobile";

export function CorrectionEditor({
  visible,
  originalText,
  isSaving,
  error,
  onClose,
  onSave,
}: CorrectionEditorProps) {
  const [text, setText] = useState(originalText);
  const [reason, setReason] = useState(DEFAULT_REASON);

  const canSave = Boolean(text.trim() && reason.trim() && !isSaving);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={isSaving ? undefined : onClose}
    >
      <View className="bg-background flex-1 px-5 pt-6">
        <View className="mb-4 flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-foreground text-xl font-semibold">
              Correct saved turn
            </Text>
            <Text className="text-muted mt-1 text-xs leading-5">
              OODA keeps the original event and appends this correction to its
              history and memory graph.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            disabled={isSaving}
            className="active:opacity-70 disabled:opacity-40"
          >
            <Text className="text-muted text-base font-semibold">Cancel</Text>
          </Pressable>
        </View>

        <ScrollView
          className="min-h-0 flex-1"
          contentContainerStyle={{ paddingBottom: 28 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
            Corrected text
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            editable={!isSaving}
            multiline
            autoFocus
            maxLength={50_000}
            placeholder="What did you mean?"
            placeholderTextColor={colors.muted2}
            textAlignVertical="top"
            className="border-border bg-card text-foreground min-h-44 rounded-xl border px-4 py-3 text-base leading-6"
          />

          <Text className="text-muted mt-5 mb-2 text-xs font-semibold tracking-wide uppercase">
            Reason recorded in history
          </Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            editable={!isSaving}
            maxLength={2_000}
            placeholder="Why are you correcting this turn?"
            placeholderTextColor={colors.muted2}
            className="border-border bg-card text-foreground rounded-xl border px-4 py-3 text-sm"
          />

          {error ? (
            <Text className="text-danger mt-3 text-sm leading-5">{error}</Text>
          ) : null}
        </ScrollView>

        <Pressable
          onPress={() => onSave(text, reason)}
          disabled={!canSave}
          className="bg-primary mb-5 rounded-xl py-3.5 active:opacity-80 disabled:opacity-40"
        >
          {isSaving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text className="text-primary-foreground text-center font-semibold">
              Save immutable correction
            </Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}
