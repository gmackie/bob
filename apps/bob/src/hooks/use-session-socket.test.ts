import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ available: false, construct: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), cleanup: undefined as undefined | (() => void) }));
vi.mock("./execution-availability", () => ({ useExecutionAvailable: () => state.available }));
// Run the hook effect synchronously to inspect the external transport boundary.
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, () => {}],
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => undefined | (() => void)) => { state.cleanup = effect(); },
}));
vi.mock("@bob/ws", () => ({ BobWsClient: class {
  constructor(options: unknown) { state.construct(options); }
  connect = state.connect;
  disconnect = state.disconnect;
} }));
import { useSessionSocket } from "./use-session-socket";
beforeEach(() => { vi.clearAllMocks(); state.available = false; state.cleanup = undefined; });
it("never constructs a gateway transport when execution is unavailable", () => {
  useSessionSocket({ gatewayUrl: "wss://fixture.invalid", token: "fixture", enabled: true });
  expect(state.construct).not.toHaveBeenCalled();
  expect(state.connect).not.toHaveBeenCalled();
});
it("retains hosted connection and cleanup when execution is available", () => {
  state.available = true;
  useSessionSocket({ gatewayUrl: "wss://fixture.invalid", token: "fixture", enabled: true });
  expect(state.construct).toHaveBeenCalledOnce();
  expect(state.connect).toHaveBeenCalledOnce();
  state.cleanup?.();
  expect(state.disconnect).toHaveBeenCalledOnce();
});
