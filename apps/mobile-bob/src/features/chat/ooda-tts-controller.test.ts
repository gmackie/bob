import { describe, expect, it, vi } from "vitest";

import { OodaTtsController } from "./ooda-tts-controller";

describe("OODA TTS controller", () => {
  it("stops current audio before loading a fresh one-use grant", async () => {
    const calls: string[] = [];
    const requestSource = vi.fn((eventId: string) => {
      calls.push(`grant:${eventId}`);
      return Promise.resolve({ uri: `https://ooda.example/${eventId}`, headers: {} });
    });
    const player = {
      pause: vi.fn(() => calls.push("pause")),
      seekTo: vi.fn(() => {
        calls.push("seek");
        return Promise.resolve();
      }),
      replace: vi.fn(() => calls.push("replace")),
      setPlaybackRate: vi.fn(() => calls.push("rate")),
      play: vi.fn(() => calls.push("play")),
    };
    const controller = new OodaTtsController(player, requestSource);

    await controller.play("event-1", "manual");

    expect(calls).toEqual([
      "pause",
      "seek",
      "grant:event-1",
      "replace",
      "rate",
      "play",
    ]);
  });

  it("requests a new grant on replay and caps playback rate at supported values", async () => {
    const requestSource = vi.fn(() => Promise.resolve({
      uri: "https://ooda.example/audio",
      headers: {},
    }));
    const player = {
      pause: vi.fn(),
      seekTo: vi.fn(() => Promise.resolve()),
      replace: vi.fn(),
      setPlaybackRate: vi.fn(),
      play: vi.fn(),
    };
    const controller = new OodaTtsController(player, requestSource);

    controller.setRate(1.5);
    await controller.play("event-1", "automatic");
    await controller.replay();

    expect(requestSource).toHaveBeenNthCalledWith(1, "event-1", "automatic");
    expect(requestSource).toHaveBeenNthCalledWith(2, "event-1", "manual");
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.5, "medium");
    expect(() => controller.setRate(3)).toThrow("Unsupported TTS playback rate");
  });
});
