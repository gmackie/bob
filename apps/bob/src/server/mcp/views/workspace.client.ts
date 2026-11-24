import { pollTool } from "./poll";
import { renderWorkspace, type WorkspaceData } from "./render";
import { mountPlanning, startView } from "./shared.client";

// In a thread-scoped panel the host supplies threadId; the runs list then
// follows the active thread.
const bridge = startView("bob-workspace", (context, previous) => {
  threadId = context.t3?.threadId;
  if (connected && threadId !== previous.t3?.threadId) void poll.refresh();
});
const root = document.getElementById("app")!;
let threadId: string | undefined;
let data: WorkspaceData | undefined;
let args: Record<string, unknown> = {};
let filter = "";
let connected = false;
const activeThread = () => threadId ?? (typeof args.threadId === "string" ? args.threadId : undefined);
let review: ReturnType<typeof mountPlanning> | undefined;

function draw() {
  if (!data) return;
  // Keep the review pane (and its state) across list refreshes.
  const pane = root.querySelector<HTMLElement>("[data-role=review]");
  root.innerHTML = renderWorkspace(data, filter, activeThread());
  if (pane) root.querySelector("[data-role=review]")!.replaceWith(pane);
  else review = mountPlanning(bridge, root.querySelector<HTMLElement>("[data-role=review]")!, data.pollSeconds);
}

const poll = pollTool<WorkspaceData>({
  bridge, name: "bob_workspace",
  args: () => ({ ...args, ...(threadId ? { threadId } : {}) }),
  matches: (value) => value.threadId === activeThread(),
  render: (value) => { data = value; draw(); },
  seconds: (value) => value.pollSeconds,
  error: (message) => { root.textContent = message; },
});

root.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.role !== "filter") return;
  filter = input.value;
  if (!data) return;
  // Replacing the focused input interrupts native WebView text entry.
  const template = document.createElement("template");
  template.innerHTML = renderWorkspace(data, filter, activeThread());
  root.querySelector('[aria-label="Work items"]')!.replaceWith(template.content.querySelector('[aria-label="Work items"]')!);
});

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (target?.dataset.action === "refresh") void poll.refresh();
  if (target?.dataset.action === "review" && target.dataset.workItemId) void review?.load(target.dataset.workItemId);
});

bridge.onToolInput = (input) => {
  args = input;
};
void bridge.connect().then(() => { connected = true; poll.start(); });
