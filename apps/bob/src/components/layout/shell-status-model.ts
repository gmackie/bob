export type ShellRealtimeConnectionStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected"
  | string;

export type ShellRealtimeStatusTone = "success" | "warning" | "muted";

export interface ShellRealtimeStatusModel {
  label: string;
  detail: string;
  tone: ShellRealtimeStatusTone;
}

export function getShellRealtimeStatusModel(
  status: ShellRealtimeConnectionStatus,
): ShellRealtimeStatusModel {
  switch (status) {
    case "connected":
      return {
        label: "Live",
        detail: "WebSocket connected",
        tone: "success",
      };
    case "connecting":
      return {
        label: "Connecting",
        detail: "Connecting to websocket",
        tone: "warning",
      };
    case "reconnecting":
      return {
        label: "Reconnecting",
        detail: "Reconnecting to websocket",
        tone: "warning",
      };
    default:
      return {
        label: "Polling",
        detail: "WebSocket disconnected; short polling active",
        tone: "muted",
      };
  }
}
