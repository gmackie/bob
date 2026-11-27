import type { Beat } from "./beat";
import type { RecordedBeat } from "./beat-log";

export interface ControlRoomFeed {
  agent: Beat | null;
  ci: Beat | null;
  shipment: Beat | null;
  events: Beat[];
}

/** The log is newest first. A busy terminal must not drown out a CI result from the same frame. */
export function controlRoomFeed(
  recent: readonly RecordedBeat[],
  now: number,
  itemIds?: ReadonlySet<string>,
): ControlRoomFeed {
  const result: ControlRoomFeed = { agent: null, ci: null, shipment: null, events: [] };
  let lastActivity: Beat | undefined;
  for (const beat of recent) {
    if (itemIds && beat.subject.itemId && !itemIds.has(beat.subject.itemId)) continue;
    if (beat.kind === "agent.activity") lastActivity ??= beat;
    else if (result.events.length < 3) result.events.push(beat);
    const age = now - beat.receivedAt;
    if (age < 0 || age >= 2_200) continue;
    switch (beat.kind) {
      case "agent.activity":
      case "agent.action":
        result.agent ??= beat;
        break;
      case "ci.phase":
      case "ci.green":
        result.ci ??= beat;
        break;
      case "release.stage":
        if (beat.data?.to === "deploying" || beat.data?.to === "production-verified")
          result.shipment ??= beat;
        break;
      case "milestone":
        if (beat.data?.milestone === "production-verified") result.shipment ??= beat;
        break;
    }
  }
  if (!result.events.length && lastActivity) result.events.push(lastActivity);
  return result;
}
