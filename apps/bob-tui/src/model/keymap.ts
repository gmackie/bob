// Keyboard handling as a pure state machine: (ui state, key, context) → (ui state, effects).
// The Ink app only forwards keys and performs the effects, so node tests cover every binding.
import {
  confirmationSatisfies,
  itemCommands,
  planCommands,
  type CommandOption,
  type Confirmation,
  type EdgeView,
} from "@bob/sdlc-view";

import { answerablePending, flowKey, resolveInputOption, startFlow, type AnswerFlow } from "./attempt";
import { isInFlight, latestFor, resourceIdOf, type CommandsState } from "./commands";
import {
  childrenOf,
  drillPath,
  inbox,
  keyAtLevel,
  levelOf,
  pathForRow,
  selectionOf,
  upPath,
  type TreeNode,
  type TreePath,
} from "./tree";

/**
 * A command the user can pick, with the target it names. `answer` marks the pending-input
 * entry: picking it opens the answer flow instead of sending `option` (a placeholder).
 */
export interface Choice { option: CommandOption; target: string; answer?: true }

export type Mode =
  | { kind: "browse" }
  | { kind: "help" }
  | { kind: "palette"; choices: Choice[]; index: number }
  | { kind: "confirm"; choice: Choice }
  | { kind: "typed"; choice: Choice; expected: string; text: string }
  | { kind: "answer"; flow: AnswerFlow };

export interface UiState {
  path: TreePath;
  cursor: number;
  mode: Mode;
  /** One line under the panes: the last refusal or hint. */
  message: string | null;
}

export const initialUi = (): UiState => ({ path: {}, cursor: 0, mode: { kind: "browse" }, message: null });

/** The subset of Ink's Key the bindings read. */
export interface KeyInfo {
  upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean;
  return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; tab?: boolean; shift?: boolean;
}

export type Effect =
  | { type: "send"; option: CommandOption; label: string; confirm?: Confirmation }
  | { type: "quit" };

export interface KeyContext {
  view: EdgeView;
  commands: CommandsState;
  /** Why no command can be sent right now (socket down, coordinator offline), else null. */
  blocked: string | null;
}

export interface KeyResult { ui: UiState; effects: Effect[] }

const clamp = (n: number, len: number) => (len === 0 ? 0 : Math.max(0, Math.min(len - 1, n)));

/** The left pane's nodes and the one under the cursor. */
export function cursorNode(view: EdgeView, ui: UiState): { nodes: TreeNode[]; node: TreeNode | undefined; index: number } {
  const nodes = childrenOf(view, ui.path);
  const index = levelOf(ui.path) === "item" ? Math.max(0, nodes.findIndex((n) => n.key === ui.path.itemId)) : clamp(ui.cursor, nodes.length);
  return { nodes, node: nodes[index], index };
}

/** Every command for the current selection: the plan's, then the item's. */
export function choicesFor(view: EdgeView, ui: UiState): Choice[] {
  const { node } = cursorNode(view, ui);
  const sel = selectionOf(view, ui.path, node);
  const out: Choice[] = [];
  if (sel.plan) for (const option of planCommands(sel.plan)) out.push({ option, target: sel.plan.planId.slice(0, 8) });
  if (sel.item) {
    const target = sel.itemLabel ?? sel.item.itemId.slice(0, 8);
    const pending = answerablePending(sel.item);
    // Answering is what the agent is blocked on, so it comes first.
    if (pending) out.unshift({ option: { ...resolveInputOption(sel.item.itemId, pending, {}), label: "Answer pending input" }, target, answer: true });
    for (const option of itemCommands(sel.item)) out.push({ option, target });
  }
  return out;
}

const done = (ui: UiState, effects: Effect[] = []): KeyResult => ({ ui, effects });
const say = (ui: UiState, message: string): KeyResult => done({ ...ui, mode: { kind: "browse" }, message });

/** Starts a command: refuses it when blocked or in flight, else asks for the tier's confirmation or sends it. */
export function begin(ui: UiState, choice: Choice, ctx: KeyContext): KeyResult {
  if (ctx.blocked) return say(ui, `${choice.option.label}: ${ctx.blocked}`);
  const latest = latestFor(ctx.commands, resourceIdOf(choice.option.command));
  if (latest && isInFlight(latest)) return say(ui, `Waiting for "${latest.label}" to finish.`);
  if (choice.answer) {
    const command = choice.option.command;
    const item = command.operation === "ResolveInput" ? ctx.view.items[command.input.itemId] : undefined;
    const pending = answerablePending(item);
    if (!item || !pending) return say(ui, "Nothing is waiting for input here.");
    return done({ ...ui, mode: { kind: "answer", flow: startFlow(item.itemId, choice.target, pending) }, message: null });
  }
  const label = `${choice.option.label} ${choice.target}`;
  if (choice.option.tier === 1) return done({ ...ui, mode: { kind: "browse" }, message: null }, [{ type: "send", option: choice.option, label }]);
  if (choice.option.tier === 2) return done({ ...ui, mode: { kind: "confirm", choice }, message: null });
  if (!choice.option.expected) return say(ui, `${label} needs typed confirmation, but the edge gave nothing to type.`);
  return done({ ...ui, mode: { kind: "typed", choice, expected: choice.option.expected, text: "" }, message: null });
}

const find = (choices: Choice[], pred: (c: Choice) => boolean) => choices.find(pred);
const isPlanAction = (c: Choice, ...actions: string[]) => c.option.command.operation === "ControlPlan" && actions.includes(c.option.command.input.action);

function browse(ui: UiState, input: string, key: KeyInfo, ctx: KeyContext): KeyResult {
  const { view } = ctx;
  const { nodes, node, index } = cursorNode(view, ui);
  const level = levelOf(ui.path);
  const move = (delta: number): KeyResult => {
    const next = clamp(index + delta, nodes.length);
    if (level === "item" && nodes[next]) return done({ ...ui, path: { ...ui.path, itemId: nodes[next]!.key }, cursor: next, message: null });
    return done({ ...ui, cursor: next, message: null });
  };

  if (key.upArrow || input === "k") return move(-1);
  if (key.downArrow || input === "j") return move(1);
  if (input === "g") return move(-nodes.length);
  if (input === "G") return move(nodes.length);
  if (key.return || key.rightArrow || input === "l") {
    if (!node || level === "item") return done(ui);
    return done({ ...ui, path: drillPath(ui.path, node), cursor: 0, message: null });
  }
  if (key.escape || key.leftArrow || key.backspace || key.delete || input === "h") {
    if (level === "fleet") return done(ui);
    const up = upPath(ui.path);
    const back = keyAtLevel(ui.path);
    const cursor = Math.max(0, childrenOf(view, up).findIndex((n) => n.key === back));
    return done({ ...ui, path: up, cursor, message: null });
  }
  if (input === "q") return done(ui, [{ type: "quit" }]);
  if (input === "?") return done({ ...ui, mode: { kind: "help" } });
  if (input === "i" || key.tab) {
    // Jump to the next inbox item after the current one, wrapping.
    const rows = inbox(view);
    if (!rows.length) return say(ui, "Inbox is empty.");
    const at = rows.findIndex((r) => r.item.itemId === ui.path.itemId);
    const row = rows[(at + 1) % rows.length]!;
    return done({ ...ui, path: pathForRow(row), cursor: 0, message: null });
  }

  const choices = choicesFor(view, ui);
  if (input === ":") {
    if (!choices.length) return say(ui, "No commands for this selection.");
    return done({ ...ui, mode: { kind: "palette", choices, index: 0 }, message: null });
  }
  if (input === "p") {
    const c = find(choices, (c) => isPlanAction(c, "pause", "resume"));
    return c ? begin(ui, c, ctx) : say(ui, "No plan to pause or resume here.");
  }
  if (input === "c") {
    // With an item selected, c only ever cancels that item; cancelling the whole plan
    // from inside it goes through the palette, so a stray c never targets the plan.
    const itemSelected = levelOf(ui.path) === "item" || (levelOf(ui.path) === "plan" && node?.kind === "item");
    const c = itemSelected
      ? find(choices, (c) => c.option.command.operation === "CancelItem")
      : find(choices, (c) => isPlanAction(c, "cancel"));
    return c ? begin(ui, c, ctx) : say(ui, itemSelected ? "This item cannot be cancelled in its state (use : for plan commands)." : "Nothing to cancel here.");
  }
  if (input === "a") {
    const c = find(choices, (c) => !!c.answer);
    return c ? begin(ui, c, ctx) : say(ui, "Nothing is waiting for input here.");
  }
  if (input === "r") {
    const c = find(choices, (c) => c.option.command.operation === "RetryItem");
    return c ? begin(ui, c, ctx) : say(ui, "Retry needs a failed or execution-unknown item with a previous attempt.");
  }
  return done(ui);
}

export function handleKey(ui: UiState, input: string, key: KeyInfo, ctx: KeyContext): KeyResult {
  const mode = ui.mode;
  switch (mode.kind) {
    case "browse":
      return browse(ui, input, key, ctx);
    case "help":
      return done({ ...ui, mode: { kind: "browse" } });
    case "palette": {
      if (key.escape) return done({ ...ui, mode: { kind: "browse" } });
      if (key.upArrow || input === "k") return done({ ...ui, mode: { ...mode, index: clamp(mode.index - 1, mode.choices.length) } });
      if (key.downArrow || input === "j") return done({ ...ui, mode: { ...mode, index: clamp(mode.index + 1, mode.choices.length) } });
      const digit = Number(input);
      if (Number.isInteger(digit) && digit >= 1 && digit <= mode.choices.length) return begin(ui, mode.choices[digit - 1]!, ctx);
      if (key.return) return begin(ui, mode.choices[mode.index]!, ctx);
      return done(ui);
    }
    case "confirm": {
      const label = `${mode.choice.option.label} ${mode.choice.target}`;
      if (input === "y" || input === "Y") {
        return done({ ...ui, mode: { kind: "browse" }, message: null }, [{ type: "send", option: mode.choice.option, label, confirm: { confirmed: true } }]);
      }
      if (input === "n" || input === "N" || key.escape) return say(ui, `${label}: not sent.`);
      return done(ui);
    }
    case "typed": {
      const label = `${mode.choice.option.label} ${mode.choice.target}`;
      if (key.escape) return say(ui, `${label}: not sent.`);
      if (key.return) {
        const confirm: Confirmation = { confirmed: true, typed: mode.text };
        if (!confirmationSatisfies(mode.choice.option.tier, confirm, mode.expected)) return done({ ...ui, message: `Type ${mode.expected} exactly to confirm.` });
        return done({ ...ui, mode: { kind: "browse" }, message: null }, [{ type: "send", option: mode.choice.option, label, confirm }]);
      }
      if (key.backspace || key.delete) return done({ ...ui, mode: { ...mode, text: mode.text.slice(0, -1) } });
      if (input && !key.ctrl && !key.tab) return done({ ...ui, mode: { ...mode, text: mode.text + input } });
      return done(ui);
    }
    case "answer": {
      const result = flowKey(mode.flow, input, key);
      const label = `Answer ${mode.flow.target}`;
      if (result.kind === "cancel") return say(ui, `${label}: not sent.`);
      if (result.kind === "continue") return done({ ...ui, mode: { kind: "answer", flow: result.flow } });
      // Re-check at submit: the socket or coordinator may have gone, or the question been answered elsewhere.
      if (ctx.blocked) return done({ ...ui, mode: { kind: "answer", flow: { ...result.flow, error: `Not sent: ${ctx.blocked}.` } } });
      const latest = latestFor(ctx.commands, result.flow.itemId);
      if (latest && isInFlight(latest)) return done({ ...ui, mode: { kind: "answer", flow: { ...result.flow, error: `Waiting for "${latest.label}" to finish.` } } });
      const current = answerablePending(ctx.view.items[result.flow.itemId]);
      if (!current || current.promptId !== result.flow.pending.promptId) return say(ui, `${label}: the question is no longer pending.`);
      const option = resolveInputOption(result.flow.itemId, result.flow.pending, result.answers);
      return done({ ...ui, mode: { kind: "browse" }, message: null }, [{ type: "send", option, label }]);
    }
  }
}
