"use client";

import { useEffect, useRef, useState } from "react";

// Phase 5 M3: voice capture. A dictation button that transcribes speech into the
// capture note via the browser's Web Speech API, then flows through the existing
// vault.write pipeline. Feature-detected: renders nothing when the API is
// unavailable (SSR / Cloudflare Workers / unsupported browsers), so it can only
// ever add capability, never break the page.

// Minimal shape of the Web Speech recognition object (not in lib.dom types on
// every setup). We only touch the members we use.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceCaptureButton({
  onTranscript,
}: {
  /** Called with each final transcript chunk. */
  onTranscript: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // Feature detection runs after mount so SSR and the client agree on the
  // initial (hidden) render, avoiding hydration mismatch.
  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => {
      recRef.current?.stop();
    };
  }, []);

  function toggle() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) text += result[0]?.transcript ?? "";
      }
      const trimmed = text.trim();
      if (trimmed) onTranscript(trimmed);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Dictate note"}
      className={`rounded-[3px] border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        listening
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-subtle hover:text-muted-foreground"
      }`}
    >
      {listening ? "◼ Stop dictation" : "🎤 Dictate"}
    </button>
  );
}
