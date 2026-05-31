import { useCallback, useEffect, useRef, useState } from "react";
import type { GestureResponderHandlers } from "react-native";
import {
  PanResponder,
  Pressable,
  Text,
  View,
} from "react-native";

import { colors } from "~/lib/colors";

import { KeyboardInput } from "./keyboard-input";
import { useSpeechRecognition } from "../hooks/use-speech-recognition";
import type { VoiceGestureSnapshot } from "../voice-state-machine";
import { reduceVoiceGesture } from "../voice-state-machine";

interface VoiceInputBarProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const emptySnapshot: VoiceGestureSnapshot = {
  phase: "idle",
  transcript: "",
  interimTranscript: "",
};

export function VoiceInputBar({ onSend, disabled = false }: VoiceInputBarProps) {
  const speech = useSpeechRecognition();
  const [snapshot, setSnapshot] = useState<VoiceGestureSnapshot>(emptySnapshot);
  const snapshotRef = useRef<VoiceGestureSnapshot>(emptySnapshot);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [panHandlers, setPanHandlers] = useState<GestureResponderHandlers>({});

  const setVoiceSnapshot = useCallback((nextSnapshot: VoiceGestureSnapshot) => {
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
  }, []);

  const applySpeechSnapshot = useCallback(
    () => ({
      ...snapshotRef.current,
      transcript: speech.transcript,
      interimTranscript: speech.interimTranscript,
    }),
    [speech.interimTranscript, speech.transcript],
  );

  const cancel = useCallback(() => {
    speech.cancel();
    setVoiceSnapshot(emptySnapshot);
  }, [setVoiceSnapshot, speech]);

  const finish = useCallback(async () => {
    const stoppedText = await speech.stop();
    const text = stoppedText.trim();
    setVoiceSnapshot(emptySnapshot);
    if (text) onSend(text);
  }, [onSend, setVoiceSnapshot, speech]);

  const start = useCallback(() => {
    if (disabled) return;
    const reduction = reduceVoiceGesture(snapshotRef.current, { type: "press" });
    setVoiceSnapshot(reduction.snapshot);
    void speech.start();
  }, [disabled, setVoiceSnapshot, speech]);

  const release = useCallback(() => {
    if (snapshotRef.current.phase === "recording") {
      void finish();
    }
  }, [finish]);

  useEffect(() => {
    const responder = PanResponder.create({
      onMoveShouldSetPanResponder: () =>
        snapshotRef.current.phase === "recording",
      onPanResponderMove: (_event, gestureState) => {
        const reduction = reduceVoiceGesture(applySpeechSnapshot(), {
          type: "drag",
          translationX: gestureState.dx,
          translationY: gestureState.dy,
        });
        setVoiceSnapshot(reduction.snapshot);
        if (reduction.effect?.type === "cancel") cancel();
      },
    });
    setPanHandlers(responder.panHandlers);
  }, [applySpeechSnapshot, cancel, setVoiceSnapshot]);

  const visibleTranscript =
    speech.interimTranscript || speech.transcript || "Listening...";

  if (keyboardOpen) {
    return (
      <KeyboardInput
        onSend={onSend}
        onClose={() => setKeyboardOpen(false)}
        disabled={disabled}
      />
    );
  }

  return (
    <View className="border-border bg-card-elevated rounded-2xl border p-3">
      {snapshot.phase !== "idle" ? (
        <View className="mb-3 rounded-xl bg-background px-3 py-2">
          <Text className="text-sm text-foreground">
            {visibleTranscript}
          </Text>
          <Text className="mt-1 text-xs text-muted">
            {snapshot.phase === "locked"
              ? "Locked. Tap send or cancel."
              : "Slide up to lock, left to cancel."}
          </Text>
        </View>
      ) : speech.error ? (
        <Text className="mb-3 text-xs text-warning">
          {speech.error}
        </Text>
      ) : null}

      <View className="flex-row items-center gap-2">
        <Pressable
          {...panHandlers}
          onPressIn={start}
          onPressOut={release}
          disabled={disabled || snapshot.phase === "locked"}
          className={`flex-1 rounded-2xl py-4 active:opacity-80 disabled:opacity-50 ${
            snapshot.phase === "idle" ? "bg-primary" : "bg-danger"
          }`}
        >
          <Text className="text-center text-base font-semibold text-primary-foreground">
            {snapshot.phase === "idle" ? "Hold to talk" : "Recording"}
          </Text>
        </Pressable>

        {snapshot.phase === "locked" ? (
          <>
            <Pressable
              onPress={cancel}
              className="border-border rounded-2xl border px-4 py-4 active:opacity-80"
            >
              <Text className="font-semibold text-danger">
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={finish}
              className="bg-primary rounded-2xl px-4 py-4 active:opacity-80"
            >
              <Text className="font-semibold text-primary-foreground">
                Send
              </Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={() => setKeyboardOpen(true)}
            disabled={disabled}
            className="border-border rounded-2xl border px-4 py-4 active:opacity-80 disabled:opacity-50"
          >
            <Text className="font-semibold text-muted">
              Keyboard
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
