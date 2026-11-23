import { toolData } from "./bridge";
import { renderWorkspace, type WorkspaceData } from "./render";
import { mountPlanning, startView } from "./shared.client";

// In a thread-scoped panel the host supplies threadId; the runs list then
// follows the active thread.
const bridge = startView("bob-workspace", (context, previous) => {
  threadId = context.t3?.threadId;
  if (data && threadId !== previous.t3?.threadId) void refresh();
});
const root = document.getElementById("app")!;
let threadId: string | undefined;
let data: WorkspaceData | undefined;
let args: Record<string, unknown> = {};
let filter = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let review: ReturnType<typeof mountPlanning> | undefined;

function draw() {
  if (!data) return;
  // Keep the review pane (and its state) across list refreshes.
  const pane = root.querySelector<HTMLElement>("[data-role=review]");
  root.innerHTML = renderWorkspace(data, filter, threadId);
  if (pane) root.querySelector("[data-role=review]")!.replaceWith(pane);
  else review = mountPlanning(bridge, root.querySelector<HTMLElement>("[data-role=review]")!, data.pollSeconds);
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), data.pollSeconds * 1000);
}

async function refresh() {
  if (document.visibilityState === "hidden") {
    timer = setTimeout(() => void refresh(), 5000);
    return;
  }
  try {
    data = toolData<WorkspaceData>(await bridge.callTool("bob_workspace", args));
  } catch (cause) {
    const message = `Refresh failed: ${cause instanceof Error ? cause.message : cause}`;
    const status = root.querySelector("header .header-meta span");
    if (status) status.textContent = message;
    else root.textContent = message;
  }
  draw();
}

root.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.role !== "filter") return;
  filter = input.value;
  if (!data) return;
  // Replacing the focused input interrupts native WebView text entry.
  const template = document.createElement("template");
  template.innerHTML = renderWorkspace(data, filter, threadId);
  root.querySelector('[aria-label="Work items"]')!.replaceWith(template.content.querySelector('[aria-label="Work items"]')!);
});

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (target?.dataset.action === "refresh") void refresh();
  if (target?.dataset.action === "review" && target.dataset.workItemId) void review?.load(target.dataset.workItemId);
});

bridge.onToolInput = (input) => {
  args = input;
};
bridge.onToolResult = (result) => {
  if (result.isError) {
    root.textContent = result.content?.find((part) => part.type === "text")?.text ?? "Bob workspace failed to load.";
    return;
  }
  data = toolData<WorkspaceData>(result);
  draw();
};
// In a thread the host delivers the bob_workspace result; a thread-less panel
// (T3CODE-74) may only load the resource, so fetch if nothing arrives.
void bridge.connect().then(() => setTimeout(() => void (data ? undefined : refresh()), 250));
