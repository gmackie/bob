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

import { SpeechCaptureFinalizer } from "../speech-capture-finalizer";

export interface SpeechRecognitionHook {
  start: () => Promise<void>;
  stop: () => Promise<{ text: string; confidence: number | null }>;
  cancel: () => void;
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  error: string | null;
  confidence: number | null;
}

function joinTranscript(finalText: string, interimText: string): string {
  return [finalText.trim(), interimText.trim()].filter(Boolean).join(" ").trim();
}

export function useSpeechRecognition(): SpeechRecognitionHook {
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const transcriptRef = useRef("");
  const interimRef = useRef("");
  const finalizerRef = useRef(new SpeechCaptureFinalizer());

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
    finalizerRef.current.end();
  });

  useSpeechRecognitionEvent("result", (event: ExpoSpeechRecognitionResultEvent) => {
    const firstResult = event.results[0];
    if (!firstResult) return;

    const text = firstResult.transcript.trim();
    if (!text) return;

    if (event.isFinal) {
      setFinalTranscript(joinTranscript(transcriptRef.current, text));
      setConfidence(firstResult.confidence);
      setInterim("");
      finalizerRef.current.acceptResult({
        text,
        isFinal: true,
        confidence: firstResult.confidence,
      });
      return;
    }

    setInterim(text);
    finalizerRef.current.acceptResult({ text, isFinal: false, confidence: null });
  });

  useSpeechRecognitionEvent("error", (event: ExpoSpeechRecognitionErrorEvent) => {
    if (event.error === "aborted") return;
    setError(event.message || event.error);
    setIsListening(false);
    finalizerRef.current.end();
  });

  const start = useCallback(async () => {
    setError(null);
    setFinalTranscript("");
    setInterim("");
    setConfidence(null);
    finalizerRef.current.reset();

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError("Speech recognition is not available on this device.");
      return;
    }

    const onDeviceSupported =
      Platform.OS !== "web" && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
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
    const finalResult = finalizerRef.current.waitForEnd();
    ExpoSpeechRecognitionModule.stop();
    setIsListening(false);
    return finalResult;
  }, []);

  const cancel = useCallback(() => {
    ExpoSpeechRecognitionModule.abort();
    setFinalTranscript("");
    setInterim("");
    setIsListening(false);
    setConfidence(null);
    finalizerRef.current.reset();
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
      confidence,
    }),
    [cancel, confidence, error, interimTranscript, isListening, start, stop, transcript],
  );
}
