import { describe, expect, it } from "vitest";

import { getShellRealtimeStatusModel } from "../shell-status-model";

describe("shell realtime status model", () => {
  it("shows a visible live status when the websocket is connected", () => {
    expect(getShellRealtimeStatusModel("connected")).toEqual({
      label: "Live",
      detail: "WebSocket connected",
      tone: "success",
    });
  });

  it("shows connection progress while the websocket is connecting or reconnecting", () => {
    expect(getShellRealtimeStatusModel("connecting")).toEqual({
      label: "Connecting",
      detail: "Connecting to websocket",
      tone: "warning",
    });
    expect(getShellRealtimeStatusModel("reconnecting")).toEqual({
      label: "Reconnecting",
      detail: "Reconnecting to websocket",
      tone: "warning",
    });
  });

  it("shows the polling fallback when the websocket is disconnected", () => {
    expect(getShellRealtimeStatusModel("disconnected")).toEqual({
      label: "Polling",
      detail: "WebSocket disconnected; short polling active",
      tone: "muted",
    });
  });
});
