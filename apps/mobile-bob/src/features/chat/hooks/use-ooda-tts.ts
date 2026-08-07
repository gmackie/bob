import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useCallback, useMemo, useState } from "react";

import {
  OodaTtsController,
} from "../ooda-tts-controller";
import type {
  OodaTtsAudioSource,
  OodaTtsPlaybackRate,
  OodaTtsRequestMode,
} from "../ooda-tts-controller";

const playbackRates: OodaTtsPlaybackRate[] = [1, 1.25, 1.5, 2];

export function useOodaTts(
  requestSource: (
    eventId: string,
    requestMode: OodaTtsRequestMode,
  ) => Promise<OodaTtsAudioSource>,
) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const controller = useMemo(
    () => new OodaTtsController(player, requestSource),
    [player, requestSource],
  );
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [rate, setRate] = useState<OodaTtsPlaybackRate>(1);
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const play = useCallback(async (
    eventId: string,
    requestMode: OodaTtsRequestMode = "manual",
  ) => {
    setError(null);
    setIsRequesting(true);
    try {
      await controller.play(eventId, requestMode);
      setActiveEventId(eventId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRequesting(false);
    }
  }, [controller]);

  const stop = useCallback(async () => {
    await controller.stop();
  }, [controller]);

  const replay = useCallback(async () => {
    setError(null);
    setIsRequesting(true);
    try {
      await controller.replay();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRequesting(false);
    }
  }, [controller]);

  const cycleRate = useCallback(() => {
    const index = playbackRates.indexOf(rate);
    const next = playbackRates[(index + 1) % playbackRates.length] ?? 1;
    controller.setRate(next);
    setRate(next);
  }, [controller, rate]);

  return {
    activeEventId,
    rate,
    isPlaying: status.playing,
    isBuffering: status.isBuffering || isRequesting,
    error,
    play,
    stop,
    replay,
    cycleRate,
  };
}
