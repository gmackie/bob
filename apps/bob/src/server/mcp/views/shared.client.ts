import { createViewBridge, toolData, type HostContext, type ViewBridge } from "./bridge";
import { esc, renderPlanning, type PlanningData } from "./render";

// host-context-changed may carry only the changed fields, so merge them.
export function startView(name: string, onContext?: (context: HostContext, previous: HostContext) => void): ViewBridge {
  const bridge = createViewBridge(window as never, { name, version: "0.2.0" });
  let context: HostContext = {};
  bridge.onHostContext = (update) => {
    const previous = context;
    context = { ...context, ...update };
    if (context.theme) document.documentElement.dataset.theme = context.theme;
    onContext?.(context, previous);
  };
  new ResizeObserver(() => bridge.sendSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight)).observe(document.body);
  return bridge;
}

// Planning review controller, shared by the standalone planning view and the
// inline review pane of the workspace view.
export function mountPlanning(bridge: ViewBridge, root: HTMLElement, pollSeconds = 15) {
  let data: PlanningData | undefined;
  let busy = false;
  let error: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const draw = () => {
    if (data) root.innerHTML = renderPlanning(data, { busy, ...(error ? { error } : {}) });
    else if (error) root.innerHTML = `<p class="error" role="alert">${esc(error)}</p>`;
    else if (busy) root.innerHTML = `<p class="row-detail">Loading planning review…</p>`;
  };
  const schedule = () => {
    clearTimeout(timer);
    // Terminal run evidence needs no background polling; Refresh remains available.
    if (data?.workflow.steps.some((step) => step.stage === "verify" && step.state === "active")) timer = setTimeout(() => void refresh(), pollSeconds * 1000);
  };
  const run = async (task: () => Promise<void>) => {
    busy = true;
    error = undefined;
    draw();
    try {
      await task();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    busy = false;
    draw();
    schedule();
  };
  const refresh = () =>
    run(async () => {
      if (data) data = toolData<PlanningData>(await bridge.callTool("bob_planning_review", { workItemId: data.workItem.id }));
    });

  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target || !data) return;
    const workItemId = data.workItem.id;
    if (target.dataset.action === "refresh-review") void refresh();
    if (target.dataset.action === "approve")
      void run(async () => {
        toolData(await bridge.callTool("bob_planning_approve", { workItemId }));
        data = toolData<PlanningData>(await bridge.callTool("bob_planning_review", { workItemId }));
      });
    if (target.dataset.action === "execute") {
      const agentType = root.querySelector<HTMLInputElement>("[data-role=agent-type]")?.value.trim();
      void run(async () => {
        toolData(await bridge.callTool("bob_planning_dispatch", { workItemId, ...(agentType ? { agentType } : {}) }));
        data = toolData<PlanningData>(await bridge.callTool("bob_planning_review", { workItemId }));
      });
    }
  });

  return {
    show(next: PlanningData) {
      data = next;
      error = undefined;
      draw();
      schedule();
    },
    load: (workItemId: string) =>
      run(async () => {
        data = toolData<PlanningData>(await bridge.callTool("bob_planning_review", { workItemId }));
      }),
  };
}
