// @gmacko/desktop-shell — Phase 6L peripheral package stub.
//
// Public surface: pure types + stub functions for the Electron desktop shell.
// No `electron` runtime dep — the consuming `apps/desktop` wires real
// Electron main-process / IPC code against these contracts later.
//   - Types: `DesktopAuthBridge`, `DesktopMenuItem`.
//   - Tagged error: `DesktopShellNotImplementedError`.
//   - Stubs: `createAuthBridge`, `buildAppMenu`, `registerProtocolHandler`.
//
// Real implementation deferred to Phase 7 (Bob migration).
import { Schema } from "effect";

export interface DesktopAuthBridge {
  readonly handleProtocolUrl: (url: string) => Promise<void>;
  readonly storeSessionToken: (token: string) => Promise<void>;
  readonly getSessionToken: () => Promise<string | null>;
}

export interface DesktopMenuItem {
  readonly label: string;
  readonly accelerator?: string;
  readonly onClick: () => void;
}

export class DesktopShellNotImplementedError extends Schema.TaggedErrorClass<DesktopShellNotImplementedError>()(
  "DesktopShellNotImplementedError",
  {
    reason: Schema.String,
    feature: Schema.optional(Schema.String),
  },
) {}

const reason = "@gmacko/desktop-shell: deferred to Phase 7 (Bob migration)";

/** Initialize the Electron main-process auth bridge. */
export function createAuthBridge(): DesktopAuthBridge {
  throw new DesktopShellNotImplementedError({
    reason,
    feature: "createAuthBridge",
  });
}

/** Build the application menu. */
export function buildAppMenu(_items: readonly DesktopMenuItem[]): never {
  throw new DesktopShellNotImplementedError({
    reason,
    feature: "buildAppMenu",
  });
}

/** Register a custom protocol handler (e.g. `gmacko://auth/callback`). */
export function registerProtocolHandler(
  _protocol: string,
  _handler: (url: string) => void,
): never {
  throw new DesktopShellNotImplementedError({
    reason,
    feature: "registerProtocolHandler",
  });
}

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoDesktopShellPhase = "6l" as const;
