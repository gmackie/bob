// GMA-774: the Bob Live Activity native module (iOS only; everywhere else it reports unsupported).
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { LiveActivityContent } from "@bob/sdlc-view";

interface EventSubscription { remove(): void }

interface Events {
  onPushToken: (event: { itemId: string; token: string }) => void;
  onEnded: (event: { itemId: string }) => void;
}

interface NativeModule {
  appId(): string;
  isSupported(): boolean;
  activeItemIds(): string[];
  tokens(): Record<string, string>;
  start(itemId: string, state: LiveActivityContent): Promise<string>;
  update(itemId: string, state: LiveActivityContent): Promise<void>;
  end(itemId: string): Promise<void>;
  addListener<K extends keyof Events>(event: K, listener: Events[K]): EventSubscription;
}

const native = Platform.OS === "ios" ? requireOptionalNativeModule<NativeModule>("BobLiveActivity") : null;

export const BobLiveActivity = {
  /** The running app's bundle id, or null without the native module. */
  appId: (): string | null => {
    const id = native?.appId();
    return id === undefined || id === "" ? null : id;
  },
  isSupported: (): boolean => native?.isSupported() ?? false,
  activeItemIds: (): string[] => native?.activeItemIds() ?? [],
  tokens: (): Record<string, string> => native?.tokens() ?? {},
  start: (itemId: string, state: LiveActivityContent) => native ? native.start(itemId, state) : Promise.reject(new Error("Live Activities are not available in this build.")),
  update: (itemId: string, state: LiveActivityContent) => native ? native.update(itemId, state) : Promise.resolve(),
  end: (itemId: string) => native ? native.end(itemId) : Promise.resolve(),
  onPushToken: (listener: Events["onPushToken"]) => native?.addListener("onPushToken", listener) ?? null,
  onEnded: (listener: Events["onEnded"]) => native?.addListener("onEnded", listener) ?? null,
};
