// ui://bob/sdlc.html. One view, two panels: in a thread panel (hostContext.t3.threadId)
// the SDLC item running that thread, otherwise the fleet. The view opens the edge
// socket itself with a single-use ticket from bob_sdlc_connect, since the MCP server
// is stateless; the resource declares the edge origin in _meta.ui.csp.connectDomains.
import { createBackoff, createEdgeClient } from "~/components/sdlc/edge-client";

import { toolData } from "./bridge";
import { edgeStatus, fleet, itemForThread, threadItem, type SdlcData } from "./sdlc-model";
import { renderSdlc } from "./sdlc.render";
import { startView } from "./shared.client";

const root = document.getElementById("app")!;
let threadId: string | undefined;
let connected = false;
let connection: "idle" | "connecting" | "live" | "reconnecting" = "idle";
let error: string | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let drawTimer: ReturnType<typeof setTimeout> | undefined;
const backoff = createBackoff();

const client = createEdgeClient({
  send: (data) => {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(data);
    return true;
  },
  onView: () => scheduleDraw(),
  onAttempt: () => scheduleDraw(),
});

function data(): SdlcData {
  const status = edgeStatus({ view: client.view, connection, error }, 0);
  if (!threadId) return { scope: "fleet", ...fleet(client.view), ...status };
  const item = itemForThread(client.view, threadId);
  const attempt = client.attempt;
  const detail = item
    ? {
        ...(attempt.tails[item.itemId] ? { tail: attempt.tails[item.itemId] } : {}),
        ...(attempt.ci[item.itemId] ? { ci: attempt.ci[item.itemId] } : {}),
        ...(attempt.unavailable[item.itemId] ? { tailUnavailable: attempt.unavailable[item.itemId] } : {}),
      }
    : {};
  return { scope: "thread", threadId, item: item ? threadItem(client.view, item, detail) : null, ...status };
}

function draw() {
  drawTimer = undefined;
  // The edge relays tail and CI only to sockets that watch the item.
  client.watch(threadId ? (itemForThread(client.view, threadId)?.itemId ?? null) : null);
  root.innerHTML = renderSdlc(data());
}

// Deltas can arrive in bursts; one repaint per burst is enough.
function scheduleDraw() {
  drawTimer ??= setTimeout(draw, 200);
}

async function open() {
  clearTimeout(reconnectTimer);
  connection = connection === "idle" ? "connecting" : "reconnecting";
  scheduleDraw();
  let url: string;
  try {
    url = toolData<{ url: string }>(await bridge.callTool("bob_sdlc_connect")).url;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    return retry();
  }
  const current = new WebSocket(url);
  socket = current;
  current.onopen = () => {
    connection = "live";
    error = null;
    client.opened();
    scheduleDraw();
  };
  current.onmessage = (event) => {
    if (client.received(event.data)) backoff.heard();
  };
  current.onclose = (event) => {
    if (socket !== current) return;
    socket = null;
    if (event.code !== 1000 && event.code !== 1005) error = `The SDLC edge closed the socket (${event.code}${event.reason ? ` ${event.reason}` : ""}).`;
    retry();
  };
}

function retry() {
  connection = "reconnecting";
  scheduleDraw();
  reconnectTimer = setTimeout(() => void open(), backoff.nextDelay());
}

const bridge = startView("bob-sdlc", (context, previous) => {
  threadId = context.t3?.threadId ?? threadId;
  if (connected && context.t3?.threadId !== previous.t3?.threadId) scheduleDraw();
});

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (target?.dataset.action !== "refresh") return;
  if (socket) scheduleDraw();
  else void open();
});

// An agent's bob_sdlc call names the thread when the panel has none.
bridge.onToolInput = (input) => {
  if (!threadId && typeof input.threadId === "string") threadId = input.threadId;
};
bridge.onToolResult = (result) => {
  if (result.isError) root.textContent = result.content?.find((part) => part.type === "text")?.text ?? "Bob SDLC failed to load.";
};

// Offline is judged against the clock, so redraw now and then even without messages.
setInterval(scheduleDraw, 30_000);
void bridge.connect().then(() => {
  connected = true;
  void open();
});
