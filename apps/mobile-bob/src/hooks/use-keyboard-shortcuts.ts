import { useEffect } from "react";
import { Platform } from "react-native";

type ShortcutHandler = () => void;

interface KeyboardShortcut {
  /** Single character key (lowercase) */
  key: string;
  /** Require Cmd/Ctrl modifier */
  command?: boolean;
  /** Require Shift modifier */
  shift?: boolean;
  handler: ShortcutHandler;
  /** Description for discoverability */
  label: string;
}

/**
 * Register iPad hardware keyboard shortcuts via UIKeyCommand.
 *
 * On non-iPad platforms, this is a no-op.
 *
 * Implementation: uses the `keydown` event on the document (web) or
 * a native module (iOS). For now, we use a polling approach with
 * RCTKeyCommandsManager if available, falling back to no-op.
 *
 * TODO: Replace with react-native-key-command for production.
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  useEffect(() => {
    if (Platform.OS !== "ios" || !Platform.isPad) return;

    // React Native 0.84+ supports hardware keyboard events on iOS
    // via the RCTKeyWindow responder chain. For now, we register
    // shortcuts as a reference for future native module integration.
    //
    // The actual key event handling requires either:
    // 1. react-native-key-command (Expensify's package)
    // 2. A custom native module wrapping UIKeyCommand
    // 3. Expo Module API key command support
    //
    // Placeholder: log registered shortcuts for development.
    if (__DEV__) {
      console.log(
        "[Shortcuts] Registered:",
        shortcuts.map((s) => `${s.command ? "⌘" : ""}${s.shift ? "⇧" : ""}${s.key} → ${s.label}`),
      );
    }

    // No cleanup needed for placeholder
  }, [shortcuts]);
}

/**
 * Standard tablet keyboard shortcuts.
 * Call this in TabletLayout with the appropriate handlers.
 */
export function useTabletShortcuts({
  onFocusSidebar,
  onFocusMain,
  onToggleInspector,
  onSendMessage,
}: {
  onFocusSidebar: () => void;
  onFocusMain: () => void;
  onToggleInspector: () => void;
  onSendMessage?: () => void;
}) {
  useKeyboardShortcuts([
    { key: "1", command: true, handler: onFocusSidebar, label: "Focus sidebar" },
    { key: "2", command: true, handler: onFocusMain, label: "Focus main pane" },
    { key: "3", command: true, handler: onToggleInspector, label: "Toggle inspector" },
    ...(onSendMessage
      ? [{ key: "Enter", command: true, handler: onSendMessage, label: "Send message" } as const]
      : []),
  ]);
}
