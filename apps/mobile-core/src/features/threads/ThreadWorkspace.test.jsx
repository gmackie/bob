// @vitest-environment jsdom
import React, { act, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThreadWorkspace } from "./ThreadWorkspace";
import { startExplorationInput } from "./workspace";

const device = vi.hoisted(() => ({ fontScale: 1, layout: null }));
const alice = {
  id: "a",
  title: "Alpha",
  activeBranchId: "alpha-branch",
  status: "active",
  tags: [],
};
const beta = { ...alice, id: "b", title: "Beta" };
const alphaRun = {
  id: "run-a",
  threadId: "a",
  topic: "Alpha topic",
  status: "awaiting_input",
  depth: 1,
  articlesWrittenCount: 0,
  lastCheckIn: {
    id: "check-a",
    summary: "Alpha check-in",
    suggestedDirections: [],
    articlesWritten: [],
  },
};
const otherRun = {
  ...alphaRun,
  id: "run-b",
  threadId: "b",
  topic: "Beta topic",
};
const mutations = vi.hoisted(() => ({
  start: vi.fn(),
  respond: vi.fn(),
  chat: vi.fn(),
}));
const router = vi.hoisted(() => ({
  setParams: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  dismissTo: vi.fn(),
}));
vi.mock("expo-router", () => ({ router }));
vi.mock("~/utils/api", () => ({
  rpc: {
    threads: {
      list: async () => [alice, beta],
      byId: async (id) => (id === "a" ? alice : beta),
    },
    messages: { listByBranch: async () => [] },
    agent: { chat: mutations.chat },
    exploration: {
      list: async () => [otherRun, alphaRun],
      start: mutations.start,
      respond: mutations.respond,
    },
  },
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }) => <div>{children}</div>,
}));
vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ fontScale: device.fontScale }),
  Platform: { OS: "ios" },
  StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
  View: ({ children, onLayout }) => {
    if (onLayout) device.layout = onLayout;
    return <div>{children}</div>;
  },
  Text: ({ children }) => <span>{children}</span>,
  ActivityIndicator: () => null,
  RefreshControl: () => null,
  KeyboardAvoidingView: ({ children }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityState,
  }) => (
    <button
      disabled={disabled}
      aria-label={accessibilityLabel}
      aria-selected={accessibilityState?.selected}
      onClick={onPress}
    >
      {children}
    </button>
  ),
  TextInput: ({ value, onChangeText, accessibilityLabel }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onInput={(event) => onChangeText(event.target.value)}
      readOnly
    />
  ),
  FlatList: ({
    data,
    keyExtractor,
    renderItem,
    ListEmptyComponent,
    ListHeaderComponent,
    ListFooterComponent,
  }) => (
    <div>
      {ListHeaderComponent}
      {data.length
        ? data.map((item) => (
            <Fragment key={keyExtractor(item)}>{renderItem({ item })}</Fragment>
          ))
        : ListEmptyComponent}
      {ListFooterComponent}
    </div>
  ),
}));

let root, container, qc, role;
function render() {
  root.render(
    <QueryClientProvider client={qc}>
      <ThreadWorkspace threadId="a" role={role} />
    </QueryClientProvider>,
  );
}
async function resize(width, fontScale = 1) {
  await act(async () => {
    device.fontScale = fontScale;
    device.layout({ nativeEvent: { layout: { width } } });
    render();
  });
}
function labeled(name) {
  return container.querySelector(`[aria-label="${name}"]`);
}
async function click(name) {
  await act(async () => labeled(name).click());
}
async function type(name, value) {
  await act(async () => {
    const input = labeled(name);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  role = "explorations";
  device.fontScale = 1;
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["threads"], [alice, beta]);
  qc.setQueryData(["explorations"], [otherRun, alphaRun]);
  qc.setQueryData(
    ["messages", "a", "alpha-branch"],
    [{ id: "message", role: "assistant", content: "Recorded reply" }],
  );
  container = document.createElement("div");
  root = createRoot(container);
  router.setParams.mockImplementation(({ section }) => {
    role = section;
    render();
  });
  await act(async () => render());
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
});

it("keeps the selected thread, exploration topic and check-in redirect across folding and large text", async () => {
  await resize(710);
  expect(labeled("Alpha, active").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("Alpha check-in");
  expect(container.textContent).not.toContain("Beta topic");
  await type("Exploration topic", "  Next question  ");
  await click("Redirect");
  await type("New check-in direction", "Look at costs");
  await resize(350);
  expect(labeled("Alpha, active")).toBeNull();
  expect(labeled("Back to threads")).toBeTruthy();
  await resize(710, 1.5);
  expect(labeled("Alpha, active")).toBeNull();
  await resize(1024, 1.5);
  expect(labeled("Alpha, active")).toBeTruthy();
  expect(labeled("Exploration topic").value).toBe("  Next question  ");
  expect(labeled("New check-in direction").value).toBe("Look at costs");
  await click("Submit new direction");
  expect(mutations.respond.mock.calls[0][0]).toEqual({
    explorationId: "run-a",
    checkInId: "check-a",
    direction: "redirect",
    redirectTopic: "Look at costs",
  });
  await click("Start exploration");
  expect(mutations.start.mock.calls[0][0]).toEqual({
    threadId: "a",
    branchId: "alpha-branch",
    topic: "Next question",
  });
  expect(
    startExplorationInput({ ...alice, activeBranchId: null }, "topic"),
  ).toBeNull();
});

it("keeps the conversation role, attributed messages and unsent text when the list reappears", async () => {
  await resize(375);
  await click("Conversation");
  await type("Thread message", "Reply from phone");
  await resize(820);
  expect(labeled("Conversation").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("assistantRecorded reply");
  expect(labeled("Thread message").value).toBe("Reply from phone");
  await resize(390);
  await click("Send");
  expect(mutations.chat.mock.calls[0][0]).toEqual({
    threadId: "a",
    branchId: "alpha-branch",
    content: "Reply from phone",
  });
});
