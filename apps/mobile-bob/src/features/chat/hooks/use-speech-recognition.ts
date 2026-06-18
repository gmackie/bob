import { useCallback, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";

export interface SpeechRecognitionHook {
  start: () => Promise<void>;
  stop: () => Promise<string>;
  cancel: () => void;
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  error: string | null;
}

function joinTranscript(finalText: string, interimText: string): string {
  return [finalText.trim(), interimText.trim()].filter(Boolean).join(" ").trim();
}

export function useSpeechRecognition(): SpeechRecognitionHook {
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef("");
  const interimRef = useRef("");

  const setFinalTranscript = useCallback((value: string) => {
    transcriptRef.current = value;
    setTranscript(value);
  }, []);

  const setInterim = useCallback((value: string) => {
    interimRef.current = value;
    setInterimTranscript(value);
  }, []);

  useSpeechRecognitionEvent("start", () => {
    setIsListening(true);
    setError(null);
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent("result", (event: ExpoSpeechRecognitionResultEvent) => {
    const firstResult = event.results[0];
    if (!firstResult) return;

    const text = firstResult.transcript.trim();
    if (!text) return;

    if (event.isFinal) {
      setFinalTranscript(joinTranscript(transcriptRef.current, text));
      setInterim("");
      return;
    }

    setInterim(text);
  });

  useSpeechRecognitionEvent("error", (event: ExpoSpeechRecognitionErrorEvent) => {
    if (event.error === "aborted") return;
    setError(event.message || event.error);
    setIsListening(false);
  });

  const start = useCallback(async () => {
    setError(null);
    setFinalTranscript("");
    setInterim("");

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError("Speech recognition is not available on this device.");
      return;
    }

    const onDeviceSupported =
      Platform.OS === "ios" && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    const permission = onDeviceSupported
      ? await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync()
      : await ExpoSpeechRecognitionModule.requestPermissionsAsync();

    if (!permission.granted) {
      setError("Microphone permission is required for voice input.");
      return;
    }

    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      addsPunctuation: true,
      requiresOnDeviceRecognition: onDeviceSupported,
      iosTaskHint: "dictation",
    });
  }, [setFinalTranscript, setInterim]);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setIsListening(false);
    return Promise.resolve(joinTranscript(transcriptRef.current, interimRef.current));
  }, []);

  const cancel = useCallback(() => {
    ExpoSpeechRecognitionModule.abort();
    setFinalTranscript("");
    setInterim("");
    setIsListening(false);
  }, [setFinalTranscript, setInterim]);

  return useMemo(
    () => ({
      start,
      stop,
      cancel,
      transcript,
      interimTranscript,
      isListening,
      error,
    }),
    [cancel, error, interimTranscript, isListening, start, stop, transcript],
  );
}
