import { assert, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  isReduceMotionEnabled: vi.fn(),
}));
vi.mock("react-native", () => ({ AccessibilityInfo: native }));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

it("uses live changes ahead of a stale initial read and unsubscribes on leaving the screen", async () => {
  const { observeReducedMotion } = await import("./use-system-reduced-motion");
  const remove = vi.fn();
  let resolveInitial!: (value: boolean) => void;
  const initial = new Promise<boolean>((resolve) => { resolveInitial = resolve; });
  native.addEventListener.mockReturnValue({ remove });
  native.isReduceMotionEnabled.mockReturnValue(initial);
  const changed = vi.fn();
  const stop = observeReducedMotion(changed);
  const [subscription] = native.addEventListener.mock.calls;
  assert.isDefined(subscription, "Expected a native Reduce Motion subscription");
  const [event, notify] = subscription;
  expect(event).toBe("reduceMotionChanged");
  notify(true);
  resolveInitial(false);
  await initial;
  expect(changed.mock.calls).toEqual([[true]]);
  notify(false);
  expect(changed).toHaveBeenLastCalledWith(false);
  stop();
  expect(remove).toHaveBeenCalledOnce();
});
