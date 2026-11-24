// @vitest-environment jsdom
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeApps } from "../apps";
import { emptyView, reduce } from "@bob/sdlc-view";
import { DEMO_THREADS, demoSnapshot } from "./sdlc-fixtures";
import { edgeStatus, fleet, itemForThread, threadItem } from "./sdlc-model";

const view = reduce(emptyView(), demoSnapshot());
const status = edgeStatus({ view, connection: "live", error: null }, 15);
const workspace = {
  workspaceId: "w",
  workItems: [],
  runs: [],
  pollSeconds: 60,
  refreshedAt: status.refreshedAt,
};
interface HostRequest {
  id: number;
  method: string;
  params: { name: string; arguments: { threadId?: string } };
}

// Run the script actually returned by resources/read. The host initially opens
// just a resource; all data must arrive through authenticated tools/call messages.
function mount(uri: string, threadId?: string) {
  const resource = makeApps().read(uri);
  if (!resource) throw new Error("Missing panel resource");
  const doc = new DOMParser().parseFromString(resource.text, "text/html");
  Object.defineProperty(doc, "visibilityState", { value: "visible" });
  let listener: (event: { source: unknown; data: object }) => void;
  const requests: HostRequest[] = [];
  const deliver = (message: { id?: number; method?: string; params?: unknown; result?: unknown }) =>
    listener({ source: parent, data: { jsonrpc: "2.0", ...message } });
  const parent = {
    postMessage(request: HostRequest) {
      if (request.method === "ui/initialize")
        deliver({ id: request.id, result: { hostContext: { t3: { threadId } } } });
      if (request.method === "tools/call") requests.push(request);
    },
  };
  const script = doc.querySelector("script")?.textContent;
  if (!script) throw new Error("Missing panel script");
  runInNewContext(script, {
    document: doc,
    setTimeout,
    clearTimeout,
    ResizeObserver: class {
      observe() {}
    },
    window: {
      parent,
      addEventListener: (_name: string, handle: typeof listener) => {
        listener = handle;
      },
    },
  });
  const reply = async (index: number, value: Record<string, unknown>) => {
    const request = requests[index];
    if (!request) throw new Error(`Missing tool call ${index}`);
    deliver({ id: request.id, result: { structuredContent: value } });
    await vi.advanceTimersByTimeAsync(0);
  };
  return { doc, requests, deliver, reply };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each([undefined, DEMO_THREADS.running])(
  "loads the workspace or thread runs from the host (thread %s)",
  async (threadId) => {
    const p = mount("ui://bob/workspace.html", threadId);
    await vi.advanceTimersByTimeAsync(251);
    expect(p.requests.map((request) => request.params)).toEqual([
      { name: "bob_workspace", arguments: threadId ? { threadId } : {} },
    ]);
    await p.reply(0, {
      ...workspace,
      threadId,
      runs: [{ id: "run-id", status: "running", threadId }],
    });
    expect(p.doc.body.textContent).toContain(threadId ? "Runs in this thread" : "Recent runs");
    expect(p.doc.body.textContent).toContain("run-id");
  },
);

it("switches from fleet to thread and ignores a late result for the previous thread", async () => {
  const p = mount("ui://bob/sdlc.html");
  await vi.advanceTimersByTimeAsync(251);
  expect(p.requests[0]?.params).toEqual({ name: "bob_sdlc", arguments: {} });
  await p.reply(0, { scope: "fleet", ...fleet(view), ...status });
  expect(p.doc.body.textContent).toContain("Bob SDLC fleet");
  for (const threadId of [DEMO_THREADS.running, DEMO_THREADS.waiting]) {
    p.deliver({ method: "ui/notifications/host-context-changed", params: { t3: { threadId } } });
  }
  expect(p.requests.slice(1).map((request) => request.params.arguments)).toEqual([
    { threadId: DEMO_THREADS.running },
    { threadId: DEMO_THREADS.waiting },
  ]);
  for (const index of [2, 1]) {
    const threadId = p.requests[index]?.params.arguments.threadId;
    const item = threadId && itemForThread(view, threadId);
    if (!item) throw new Error("Expected a known thread");
    await p.reply(index, {
      scope: "thread",
      threadId,
      item: threadItem(view, item),
      ...status,
    });
  }
  expect(p.doc.body.textContent).toContain("T3CODE-202");
  expect(p.doc.body.textContent).not.toContain("T3CODE-201");
});
