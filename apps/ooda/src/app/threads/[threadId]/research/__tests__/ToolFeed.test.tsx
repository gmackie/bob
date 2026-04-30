// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ToolFeed } from "../_components/ToolFeed";

type Listener = (ev: MessageEvent) => void;

interface StubEventSource {
  url: string;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  listeners: Map<string, Set<Listener>>;
  addEventListener: (type: string, fn: Listener) => void;
  removeEventListener: (type: string, fn: Listener) => void;
  close: () => void;
  dispatch: (type: string, data: unknown) => void;
}

declare global {
  var __lastEventSource: StubEventSource | undefined;
}

class EventSourceStub implements StubEventSource {
  url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    globalThis.__lastEventSource = this;
  }

  addEventListener(type: string, fn: Listener) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }

  close() {
    this.readyState = 2;
  }

  dispatch(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    this.listeners.get(type)?.forEach((fn) => fn(ev));
  }
}

const THREAD_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  globalThis.__lastEventSource = undefined;
  (globalThis as unknown as { EventSource: unknown }).EventSource = EventSourceStub;
});

afterEach(() => {
  cleanup();
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  globalThis.__lastEventSource = undefined;
});

function currentSource(): StubEventSource {
  const src = globalThis.__lastEventSource;
  if (!src) throw new Error("EventSource was not constructed");
  return src;
}

describe("ToolFeed", () => {
  it("renders a connecting banner before any event", () => {
    render(<ToolFeed threadId={THREAD_ID} />);
    const banner = screen.getByTestId("tool-feed-banner");
    expect(banner.textContent).toContain("connecting");
    expect(screen.queryByTestId("tool-call-row")).toBeNull();
  });

  it("renders a row after a tool_call event is dispatched", () => {
    render(<ToolFeed threadId={THREAD_ID} />);
    const src = currentSource();

    act(() => {
      src.onopen?.(new Event("open"));
      src.dispatch("buddy_tool_call", {
        id: 1,
        thread_id: THREAD_ID,
        tool_name: "web.search",
        op: "INSERT",
        status: "ok",
        duration_ms: 420,
      });
    });

    const row = screen.getByTestId("tool-call-row");
    expect(row.textContent).toContain("web.search");
    expect(row.textContent).toContain("420ms");
  });

  it("expands the row and shows args JSON on click", () => {
    render(<ToolFeed threadId={THREAD_ID} />);
    const src = currentSource();

    act(() => {
      src.dispatch("buddy_tool_call", {
        id: 2,
        thread_id: THREAD_ID,
        tool_name: "db.query",
        op: "INSERT",
        status: "ok",
        args: { query: "select 1" },
        result: { rows: 1 },
      });
    });

    const row = screen.getByTestId("tool-call-row");
    const button = row.querySelector("button");
    expect(button).not.toBeNull();
    expect(screen.queryByTestId("tool-call-details")).toBeNull();

    act(() => {
      fireEvent.click(button as HTMLElement);
    });

    const args = screen.getByTestId("tool-call-args");
    expect(args.textContent).toContain("select 1");
  });

  it("flips the banner to connection error on EventSource error", () => {
    render(<ToolFeed threadId={THREAD_ID} />);
    const src = currentSource();

    act(() => {
      src.onerror?.(new Event("error"));
    });

    const banner = screen.getByTestId("tool-feed-banner");
    expect(banner.textContent).toContain("connection error");
  });

  it("caps the tool-call list at 100 entries when 101 events arrive", () => {
    render(<ToolFeed threadId={THREAD_ID} />);
    const src = currentSource();

    act(() => {
      src.onopen?.(new Event("open"));
      for (let i = 0; i < 101; i++) {
        src.dispatch("buddy_tool_call", {
          id: i,
          thread_id: THREAD_ID,
          tool_name: `tool_${i}`,
          op: "INSERT",
          status: "ok",
        });
      }
    });

    const rows = screen.getAllByTestId("tool-call-row");
    expect(rows).toHaveLength(100);
    // Newest (id=100) should be first; oldest (id=0) should be dropped.
    expect(rows[0]?.textContent).toContain("tool_100");
    expect(screen.queryByText("tool_0", { exact: false })).toBeNull();
  });
});
