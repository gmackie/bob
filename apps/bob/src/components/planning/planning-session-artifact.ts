import { formatSessionEventText } from "../runs/session-event-format";

interface PlanningArtifactEvent {
  seq?: number;
  direction: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export function extractPlanningArtifactContent(
  events: PlanningArtifactEvent[],
): string | null {
  const outputParts: string[] = [];

  for (const event of events) {
    if (event.direction !== "agent") continue;

    if (event.eventType === "output_chunk") {
      const text = formatSessionEventText(event.eventType, event.payload);
      if (text.trim()) outputParts.push(text);
    }

    if (event.eventType === "message_final") {
      const text = formatSessionEventText(event.eventType, event.payload);
      if (text.trim()) outputParts.push(text);
    }
  }

  const combined = outputParts.join("").trim();
  return combined.length > 0 ? combined : null;
}
