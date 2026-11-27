import { pollTool } from "./poll";
import type { SdlcData } from "./sdlc-model";
import { renderSdlc } from "./sdlc.render";
import { startView } from "./shared.client";

const root = document.getElementById("app");
if (!root) throw new Error("Missing SDLC view root");
let hostThread: string | undefined;
let toolThread: string | undefined;
let connected = false;
const thread = () => hostThread ?? toolThread;
const bridge = startView("bob-sdlc", (context) => {
  const before = thread();
  hostThread = context.t3?.threadId;
  if (connected && thread() !== before) void poll.refresh();
});
const poll = pollTool<SdlcData>({
  bridge,
  name: "bob_sdlc",
  args: () => (thread() ? { threadId: thread() } : {}),
  matches: (data) => (data.scope === "thread" ? data.threadId === thread() : !thread()),
  render: (data) => {
    root.innerHTML = renderSdlc(data);
  },
  seconds: (data) => data.refreshSeconds,
  error: (message) => {
    root.textContent = message;
  },
});
bridge.onToolInput = (input) => {
  toolThread = typeof input.threadId === "string" ? input.threadId : undefined;
};
root.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest('[data-action="refresh"]')) void poll.refresh();
});
void bridge.connect().then(() => {
  connected = true;
  poll.start();
});
