// @gmacko/mobile-shell — Phase 6L peripheral package stub.
//
// Public surface: pure types + stub functions for the Expo mobile shell.
// Real React Native / Expo component implementations live in the consuming
// app; this package exposes the API contract the consumer compiles against.
//   - Types: `MobileSession`, `PushNotificationToken`,
//     `DeviceCodePasteScreenProps`, `PushRegistrationConfig`.
//   - Tagged error: `MobileShellNotImplementedError`.
//   - Stubs: `registerForPushNotifications`, `openDeviceCodeScreen`.
//
// Real implementation deferred to Phase 7 (Bob migration). No `react` peerDep
// — types only here, runtime in `apps/mobile`.
import { Schema } from "effect";

export interface MobileSession {
  readonly userId: string;
  readonly tenantId: string;
  readonly deviceCode: string;
}

export interface PushNotificationToken {
  readonly token: string;
  readonly platform: "ios" | "android";
}

export class MobileShellNotImplementedError extends Schema.TaggedErrorClass<MobileShellNotImplementedError>()(
  "MobileShellNotImplementedError",
  {
    reason: Schema.String,
    feature: Schema.optional(Schema.String),
  },
) {}

export interface DeviceCodePasteScreenProps {
  readonly onSubmit: (userCode: string) => void;
  readonly onCancel?: () => void;
}

export interface PushRegistrationConfig {
  readonly platform: "ios" | "android";
  readonly fcmKey?: string;
  readonly apnsKey?: string;
}

const reason = "@gmacko/mobile-shell: deferred to Phase 7 (Bob migration)";

/** Register for push notifications. Returns the device token. */
export function registerForPushNotifications(
  _config: PushRegistrationConfig,
): never {
  throw new MobileShellNotImplementedError({
    reason,
    feature: "registerForPushNotifications",
  });
}

/** Open the device-code paste screen. (React Native component — stubbed.) */
export function openDeviceCodeScreen(
  _props: DeviceCodePasteScreenProps,
): never {
  throw new MobileShellNotImplementedError({
    reason,
    feature: "openDeviceCodeScreen",
  });
}

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoMobileShellPhase = "6l" as const;
