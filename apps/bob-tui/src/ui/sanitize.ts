// Terminal-safe text for the TUI (BOB-80). Tail lines, question text, option labels, CI
// phase names, issue identifiers and coordinator messages are agent-, repo- or
// remote-sourced: ANSI/OSC/CSI escape sequences in them could repaint the screen, set the
// window title or plant hyperlinks. The relay already sanitizes; this is defense in depth.
import { stripTerminalControls } from "@bob/sdlc-view";

/** One display line: no escape sequences or control characters; tabs and line breaks become spaces. */
export const clean = (text: string | null | undefined): string =>
  text == null ? "" : stripTerminalControls(String(text)).replace(/\t/g, "  ");

/** Multi-line text (question bodies): as clean, but line feeds are kept. */
export const cleanBlock = (text: string | null | undefined): string =>
  text == null ? "" : stripTerminalControls(String(text), { multiline: true }).replace(/\t/g, "  ");
