export type OodaTtsPlaybackRate = 1 | 1.25 | 1.5 | 2;
export type OodaTtsRequestMode = "automatic" | "manual";

export interface OodaTtsAudioSource {
  uri: string;
  headers: Record<string, string>;
}

export interface OodaTtsPlayer {
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  replace(source: OodaTtsAudioSource): void;
  setPlaybackRate(rate: number, pitchCorrectionQuality?: "low" | "medium" | "high"): void;
  play(): void;
}

export class OodaTtsController {
  private activeEventId: string | null = null;
  private rate: OodaTtsPlaybackRate = 1;

  constructor(
    private readonly player: OodaTtsPlayer,
    private readonly requestSource: (
      eventId: string,
      requestMode: OodaTtsRequestMode,
    ) => Promise<OodaTtsAudioSource>,
  ) {}

  get playbackRate(): OodaTtsPlaybackRate {
    return this.rate;
  }

  setRate(rate: number): void {
    if (rate !== 1 && rate !== 1.25 && rate !== 1.5 && rate !== 2) {
      throw new Error("Unsupported TTS playback rate");
    }
    this.rate = rate;
    this.player.setPlaybackRate(rate, "medium");
  }

  async stop(): Promise<void> {
    this.player.pause();
    await this.player.seekTo(0);
  }

  async play(
    eventId: string,
    requestMode: OodaTtsRequestMode = "manual",
  ): Promise<void> {
    await this.stop();
    const source = await this.requestSource(eventId, requestMode);
    this.player.replace(source);
    this.player.setPlaybackRate(this.rate, "medium");
    this.activeEventId = eventId;
    this.player.play();
  }

  async replay(): Promise<void> {
    if (!this.activeEventId) return;
    await this.play(this.activeEventId, "manual");
  }
}
