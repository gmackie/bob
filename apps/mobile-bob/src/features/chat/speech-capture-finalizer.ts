export interface SpeechCaptureResult {
  text: string;
  confidence: number | null;
}

interface SpeechCaptureFinalizerOptions {
  endTimeoutMs?: number;
}

function joinTranscript(finalText: string, interimText: string): string {
  return [finalText.trim(), interimText.trim()].filter(Boolean).join(" ").trim();
}

export class SpeechCaptureFinalizer {
  private readonly endTimeoutMs: number;
  private finalText = "";
  private interimText = "";
  private confidence: number | null = null;
  private pending:
    | {
        promise: Promise<SpeechCaptureResult>;
        resolve: (result: SpeechCaptureResult) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;

  constructor(options: SpeechCaptureFinalizerOptions = {}) {
    this.endTimeoutMs = options.endTimeoutMs ?? 1_500;
  }

  reset(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(this.snapshot());
      this.pending = undefined;
    }
    this.finalText = "";
    this.interimText = "";
    this.confidence = null;
  }

  acceptResult(input: {
    text: string;
    isFinal: boolean;
    confidence: number | null;
  }): void {
    const text = input.text.trim();
    if (!text) return;
    if (input.isFinal) {
      this.finalText = joinTranscript(this.finalText, text);
      this.interimText = "";
      this.confidence = input.confidence;
      return;
    }
    this.interimText = text;
  }

  snapshot(): SpeechCaptureResult {
    return {
      text: joinTranscript(this.finalText, this.interimText),
      confidence: this.confidence,
    };
  }

  waitForEnd(): Promise<SpeechCaptureResult> {
    if (this.pending) return this.pending.promise;

    let resolveResult!: (result: SpeechCaptureResult) => void;
    const promise = new Promise<SpeechCaptureResult>((resolve) => {
      resolveResult = resolve;
    });
    const timer = setTimeout(() => this.end(), this.endTimeoutMs);
    this.pending = { promise, resolve: resolveResult, timer };
    return promise;
  }

  end(): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.resolve(this.snapshot());
  }
}
