import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useRef, useState } from "react";
import { itemCommands, planCommands } from "@bob/sdlc-view";

import type { Session, SessionState } from "../client/session";
import { handleKey, initialUi, cursorNode, type UiState } from "../model/keymap";
import { breadcrumb, focusOf, headerCounts, inbox, selectionOf } from "../model/tree";
import { blockedReason, connectionText, coordinatorText } from "./format";
import { CenterPane, Footer, InboxPane, TreePane } from "./panes";

export const MIN_COLUMNS = 80;
export const WIDE_COLUMNS = 120;

export type SessionHandle = Pick<Session, "state" | "subscribe" | "send" | "tick"> & Partial<Pick<Session, "watch">>;

export interface AppProps {
  session: SessionHandle;
  host: string;
  now?: () => number;
  /** Re-render and expire commands every tickMs; 0 turns it off (tests). */
  tickMs?: number;
  /** Override the terminal size (tests). */
  columns?: number;
  rows?: number;
  initial?: UiState;
}

export function App({ session, host, now = Date.now, tickMs = 1000, columns, rows, initial }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, setState] = useState<SessionState>(session.state);
  const [ui, setUi] = useState<UiState>(initial ?? initialUi);
  const [, setClock] = useState(0);
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => session.subscribe(setState), [session]);
  useEffect(() => {
    if (!tickMs) return;
    const t = setInterval(() => { session.tick(); setClock((n) => n + 1); }, tickMs);
    return () => clearInterval(t);
  }, [session, tickMs]);

  const t = now();
  const blocked = blockedReason(state.connection, state.view, t);

  useInput((input, key) => {
    const s = stateRef.current;
    const result = handleKey(uiRef.current, input, key, { view: s.view, commands: s.commands, blocked: blockedReason(s.connection, s.view, now()) });
    uiRef.current = result.ui;
    setUi(result.ui);
    for (const effect of result.effects) {
      if (effect.type === "quit") exit();
      else session.send(effect.option, effect.label, effect.confirm);
    }
  });

  const cols = columns ?? (stdout?.columns || MIN_COLUMNS);
  const height = rows ?? (stdout?.rows || 24);
  const { view, commands } = state;
  const { nodes, node, index } = cursorNode(view, ui);
  const focus = focusOf(view, ui.path, node);
  const sel = selectionOf(view, ui.path, node);
  const counts = headerCounts(view);
  const inboxRows = inbox(view);
  const conn = connectionText(state.connection);
  const coord = coordinatorText(view, t);
  const wide = cols >= WIDE_COLUMNS;
  const narrow = cols < MIN_COLUMNS;
  const treeWidth = narrow ? cols : wide ? 34 : 30;
  const listHeight = Math.max(4, height - 14);

  // Watch the attempt detail of the item in focus; null when no item is open.
  const watchedItemId = focus.kind === "item" ? focus.entry.itemId : null;
  useEffect(() => { session.watch?.(watchedItemId); }, [session, watchedItemId]);
  // Rows the item pane spends above the tail (header, state, milestones, evidence, actions, attempt header, CI, borders).
  const evidence = focus.kind === "item" ? focus.entry.item?.evidenceRefs.length ?? 0 : 0;
  const maxTail = Math.max(3, height - 26 - evidence);

  const center = (
    <CenterPane view={view} focus={focus} commands={commands} attempt={state.attempt} maxTail={maxTail}
      planOptions={sel.plan ? planCommands(sel.plan) : []} itemOptions={sel.item ? itemCommands(sel.item, sel.plan ?? undefined) : []} />
  );
  const tree = <TreePane crumbs={breadcrumb(view, ui.path)} nodes={nodes} index={index} width={treeWidth} height={listHeight} />;

  return (
    <Box flexDirection="column" width={cols}>
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text bold>Bob SDLC</Text>
          <Text dimColor> · {host} · </Text>
          <Text color={conn.color}>{conn.text}</Text>
          <Text dimColor> · </Text>
          <Text color={coord.color}>{coord.text}</Text>
          <Text dimColor> · {counts.plans} plans · {counts.items} items · </Text>
          <Text color={counts.attention ? "yellow" : "green"}>{counts.attention} need attention</Text>
        </Text>
      </Box>
      {narrow ? <Text color="yellow"> Terminal is {cols} columns; 80 or more shows the panes side by side.</Text> : null}
      {narrow ? (
        <Box flexDirection="column">{tree}{center}<InboxPane rows={inboxRows} max={3} /></Box>
      ) : wide ? (
        <Box>{tree}{center}<InboxPane rows={inboxRows} width={36} max={listHeight} /></Box>
      ) : (
        <Box flexDirection="column">
          <Box>{tree}{center}</Box>
          <InboxPane rows={inboxRows} max={3} horizontal />
        </Box>
      )}
      <Footer mode={ui.mode} message={ui.message ?? (blocked && state.connection !== "auth-failed" ? `Commands paused: ${blocked}.` : null)} commands={commands} error={state.error} />
    </Box>
  );
}
