// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { TaskBuilderFlow } from "./TaskBuilderFlow";

const state = vi.hoisted(() => ({
  widthChanged: null,
  fontScale: 1,
  params: {},
  path: "/work-items/t",
}));
const setParams = vi.hoisted(() => vi.fn());
vi.mock("expo-router", () => ({
  router: { setParams },
  useGlobalSearchParams: () => state.params,
  usePathname: () => state.path,
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
  useWindowDimensions: () => ({ fontScale: state.fontScale }),
  View: ({ children, onLayout, style }) => {
    if (onLayout) state.widthChanged = onLayout;
    return (
      <div style={Object.assign({}, ...[style].flat().filter(Boolean))}>
        {children}
      </div>
    );
  },
  Text: ({ children }) => <span>{children}</span>,
  Pressable: ({ children, onPress, accessibilityState }) => (
    <button aria-selected={accessibilityState.selected} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("./TaskExecutionPane", () => ({
  TaskExecutionPane: ({
    workItemId,
    currentSessionId,
    messageDraft,
    setMessageDraft,
  }) => (
    <input
      aria-label={`${workItemId}/${currentSessionId}`}
      value={messageDraft}
      readOnly
      onInput={(e) => setMessageDraft(e.target.value)}
    />
  ),
}));

it("keeps the linked builder and its draft as a compact workspace link expands, collapses and switches panes", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = () =>
    root.render(
      <TaskBuilderFlow workItemId="t" sessionId="builder-id" outcome={false}>
        <span>Write release notes</span>
      </TaskBuilderFlow>,
    );
  setParams.mockImplementation((params) => {
    state.params = params;
    render();
  });
  const resize = async (width, fontScale) => {
    await act(async () => {
      state.fontScale = fontScale;
      state.widthChanged({ nativeEvent: { layout: { width } } });
      render();
    });
  };
  try {
    state.path = "/work-items/t/workspace";
    await act(async () => render());
    await resize(390, 1);
    expect(container.querySelector("[aria-selected=true]").textContent).toBe(
      "Builder session",
    );
    const field = () => container.querySelector('[aria-label="t/builder-id"]');
    await act(async () => {
      field().value = "Continue with the selected patch";
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await resize(735, 1);
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Write release notes");
    await resize(735, 1.6);
    await act(async () => container.querySelector("button").click());
    expect(field()).toBeNull();
    await resize(1080, 1.6);
    expect(field().value).toBe("Continue with the selected patch");
  } finally {
    await act(async () => root.unmount());
  }
});
