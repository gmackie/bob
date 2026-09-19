import { FetchResponse } from "expo/src/winter/fetch/FetchResponse";
import { describe, expect, it, vi } from "vitest";

// Exercise Expo's real response stream with only its native event source mocked.
vi.mock("expo/src/winter/fetch/ExpoFetchModule", () => ({
  ExpoFetchModule: {
    NativeResponse: class {
      listeners = new Map<string, ((value?: unknown) => void)[]>();
      addListener(name: string, listener: (value?: unknown) => void) {
        this.listeners.set(name, [
          ...(this.listeners.get(name) ?? []),
          listener,
        ]);
      }
      emit(name: string, value?: unknown) {
        for (const listener of this.listeners.get(name) ?? []) listener(value);
      }
      async startStreaming() {
        return null;
      }
      cancelStreaming() {}
    },
  },
}));

function response() {
  return new FetchResponse(() => {}) as FetchResponse & {
    emit(name: string, value?: unknown): void;
  };
}

describe("Expo fetch native completion races", () => {
  it("ignores native completion after the Effect consumer cancels its body", async () => {
    const res = response();
    const reader = res.body!.getReader();
    await reader.cancel();
    expect(() => res.emit("didComplete")).not.toThrow();
    expect(() =>
      res.emit("didReceiveResponseData", new Uint8Array([1])),
    ).not.toThrow();
  });

  it("preserves the original error when completion follows native failure", async () => {
    const res = response();
    const reader = res.body!.getReader();
    const read = reader.read();
    res.emit("didFailWithError", "offline");
    await expect(read).rejects.toThrow("offline");
    expect(() => res.emit("didComplete")).not.toThrow();
  });

  it("delivers bytes and closes normally while ignoring duplicate completion", async () => {
    const res = response();
    const reader = res.body!.getReader();
    res.emit("didReceiveResponseData", new Uint8Array([42]));
    res.emit("didComplete");
    expect(await reader.read()).toEqual({
      done: false,
      value: new Uint8Array([42]),
    });
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(() => res.emit("didComplete")).not.toThrow();
  });
});
