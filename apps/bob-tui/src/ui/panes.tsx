import { Box, Text } from "ink";
import {
  MILESTONE_LABEL,
  MILESTONES,
  safeHref,
  STATE_PRESENTATION,
  type CommandOption,
  type EdgeView,
  type ItemState,
  type Row,
} from "@bob/sdlc-view";

import { latestFor, recent, statusText, type CommandEntry, type CommandsState } from "../model/commands";
import type { Choice, Mode } from "../model/keymap";
import { dependencyTree, planLabel, type Focus, type TreeNode } from "../model/tree";
import { ATTENTION_COLOR, ATTENTION_MARK, PLAN_COLOR, planStateLabel, stateBadge, truncate } from "./format";

const ENTRY_COLOR: Record<CommandEntry["status"], string> = {
  pending: "yellow", accepted: "cyan", succeeded: "green", failed: "red", rejected: "red", expired: "gray",
};

function CommandLine({ entry }: { entry: CommandEntry | null }) {
  if (!entry) return null;
  return <Text color={ENTRY_COLOR[entry.status]} wrap="truncate-end">{statusText(entry)}</Text>;
}

/** The left pane: the current level's nodes, windowed around the cursor. */
export function TreePane({ crumbs, nodes, index, width, height }: { crumbs: string[]; nodes: TreeNode[]; index: number; width: number; height: number }) {
  const inner = Math.max(10, width - 4);
  const visible = Math.max(3, height);
  const start = Math.max(0, Math.min(index - Math.floor(visible / 2), nodes.length - visible));
  const shown = nodes.slice(start, start + visible);
  return (
    <Box flexDirection="column" width={width} flexShrink={0} borderStyle="round" paddingX={1}>
      <Text bold wrap="truncate-start">{truncate(crumbs.join(" › "), inner)}</Text>
      {nodes.length === 0 ? <Text dimColor>(nothing here)</Text> : null}
      {start > 0 ? <Text dimColor>  ↑ {start} more</Text> : null}
      {shown.map((node, i) => {
        const at = start + i === index;
        const badge = node.kind === "item" ? stateBadge(node.state) : node.kind === "plan" ? { text: planStateLabel(node.state ?? ""), color: PLAN_COLOR[node.state ?? ""] ?? "gray" } : null;
        const tail = node.kind === "item" ? "" : ` ${node.count}${node.attention ? ` !${node.attention}` : ""}`;
        return (
          <Text key={node.key} wrap="truncate-end">
            <Text inverse={at}>{at ? "›" : " "} {node.label}</Text>
            {badge ? <Text color={badge.color}> {badge.text}</Text> : null}
            <Text color={node.attention ? "yellow" : undefined} dimColor={!node.attention}>{tail}</Text>
          </Text>
        );
      })}
      {start + visible < nodes.length ? <Text dimColor>  ↓ {nodes.length - start - visible} more</Text> : null}
    </Box>
  );
}

function Actions({ options, latest }: { options: CommandOption[]; latest: CommandEntry | null }) {
  const keyFor = (o: CommandOption) =>
    o.command.operation === "ControlPlan"
      ? o.command.input.action === "pause" || o.command.input.action === "resume" ? "p" : o.command.input.action === "cancel" ? "c" : ":"
      : o.command.operation === "RetryItem" ? "r" : o.command.operation === "CancelItem" ? "c" : ":";
  return (
    <Box flexDirection="column" marginTop={1}>
      {options.length ? (
        <Text wrap="truncate-end">
          {options.map((o) => `[${keyFor(o)}] ${o.label}${o.tier > 1 ? ` (tier ${o.tier})` : ""}`).join("  ")}
        </Text>
      ) : <Text dimColor>No commands in this state.</Text>}
      <CommandLine entry={latest} />
    </Box>
  );
}

/** The center pane: a group summary, a plan's dependency tree, or one item. */
export function CenterPane({ view, focus, commands, planOptions, itemOptions }: {
  view: EdgeView; focus: Focus; commands: CommandsState; planOptions: CommandOption[]; itemOptions: CommandOption[];
}) {
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={20} borderStyle="round" paddingX={1}>
      <CenterBody view={view} focus={focus} commands={commands} planOptions={planOptions} itemOptions={itemOptions} />
    </Box>
  );
}

function CenterBody({ view, focus, commands, planOptions, itemOptions }: {
  view: EdgeView; focus: Focus; commands: CommandsState; planOptions: CommandOption[]; itemOptions: CommandOption[];
}) {
  switch (focus.kind) {
    case "none":
      return <Text dimColor>{view.epoch === null ? "Waiting for the edge's first snapshot…" : "Nothing selected."}</Text>;
    case "group": {
      const states = (Object.entries(focus.counts) as Array<[ItemState, number]>).filter(([, n]) => n > 0);
      return (
        <Box flexDirection="column">
          <Text bold>{focus.label}</Text>
          <Text dimColor>{focus.plans} plan{focus.plans === 1 ? "" : "s"} · enter to open</Text>
          {states.length === 0 ? <Text dimColor>No item snapshots yet.</Text> : null}
          {states.map(([state, n]) => {
            const b = stateBadge(state);
            return <Text key={state}><Text color={b.color}>{b.text.padEnd(18)}</Text>{n}</Text>;
          })}
        </Box>
      );
    }
    case "plan": {
      const lines = dependencyTree(view, focus.plan);
      return (
        <Box flexDirection="column">
          <Text bold wrap="truncate-end">
            {planLabel(focus.plan)} <Text color={PLAN_COLOR[focus.plan.state] ?? "gray"}>{planStateLabel(focus.plan.state)}</Text>
            <Text dimColor> v{focus.plan.resourceVersion} · {focus.plan.definition.items.length} items · concurrency {focus.plan.definition.concurrencyLimit}</Text>
          </Text>
          <Text dimColor>Dependencies (downstream indented under upstream)</Text>
          {lines.map((line, i) => {
            const b = stateBadge(line.state);
            const at = line.itemId === focus.cursorItemId;
            return (
              <Text key={`${line.itemId}-${i}`} wrap="truncate-end">
                <Text inverse={at}>{at ? "›" : " "}{"  ".repeat(line.depth)}{line.depth > 0 ? "└ " : ""}{line.label}</Text>
                {line.repeat ? <Text dimColor> ↑ shown above</Text> : <Text color={b.color}> {b.text}</Text>}
                {line.requires ? <Text dimColor> (needs {MILESTONE_LABEL[line.requires]})</Text> : null}
              </Text>
            );
          })}
          <Actions options={planOptions} latest={latestFor(commands, focus.plan.planId)} />
        </Box>
      );
    }
    case "item": {
      const { entry, plan } = focus;
      const item = entry.item;
      const b = stateBadge(item?.state);
      const p = item ? STATE_PRESENTATION[item.state] : null;
      const issueHref = safeHref(entry.issue.url);
      return (
        <Box flexDirection="column">
          <Text bold wrap="truncate-end">{entry.issue.identifier ?? entry.issue.issueId} <Text dimColor>in {planLabel(plan)} · {entry.target.repository.repositoryId}</Text></Text>
          {issueHref ? <Text dimColor wrap="truncate-end">{issueHref}</Text> : null}
          <Text>
            State <Text color={b.color} bold>{b.text}</Text>
            {p?.hint ? <Text dimColor> · {p.hint}</Text> : null}
            {item ? <Text dimColor> · owner {p?.owner} · v{item.resourceVersion}</Text> : null}
          </Text>
          <Text>
            Milestones{" "}
            {MILESTONES.map((m) => {
              const hit = item?.achievedMilestones.includes(m) ?? false;
              return <Text key={m} color={hit ? "green" : undefined} dimColor={!hit}>{hit ? "✓" : "·"} {MILESTONE_LABEL[m]}  </Text>;
            })}
          </Text>
          {item?.execution ? (
            <Box flexDirection="column">
              <Text wrap="truncate-end">Attempt <Text color="cyan">{item.execution.attemptId}</Text></Text>
              <Text wrap="truncate-end">
                Thread <Text color="cyan">t3:{item.execution.thread.threadId}</Text>
                <Text dimColor> (env {item.execution.thread.environmentId}, project {item.execution.thread.projectId})</Text>
              </Text>
            </Box>
          ) : <Text dimColor>No execution admitted yet.</Text>}
          <Text>Evidence{item && item.evidenceRefs.length ? "" : <Text dimColor> none</Text>}</Text>
          {item?.evidenceRefs.map((ref) => {
            const href = safeHref(ref);
            return <Text key={ref} wrap="truncate-end" color={href ? "blue" : undefined} underline={!!href}>  {ref}</Text>;
          })}
          <Actions options={itemOptions} latest={latestFor(commands, entry.itemId)} />
        </Box>
      );
    }
  }
}

/** The inbox strip: attention items, worst first. `i` jumps through them. */
export function InboxPane({ rows, width, max, horizontal }: { rows: Row[]; width?: number; max: number; horizontal?: boolean }) {
  const shown = rows.slice(0, max);
  return (
    <Box flexDirection="column" width={width} flexGrow={horizontal ? 1 : 0} flexShrink={0} borderStyle="round" paddingX={1}>
      <Text bold>Inbox <Text color={rows.length ? "yellow" : "green"}>{rows.length}</Text><Text dimColor> · i to jump</Text></Text>
      {rows.length === 0 ? <Text dimColor>Nothing needs you.</Text> : null}
      {shown.map((row) => {
        const a = STATE_PRESENTATION[row.item.state].attention;
        return (
          <Text key={row.item.itemId} wrap="truncate-end">
            <Text color={ATTENTION_COLOR[a]}>{ATTENTION_MARK[a]} </Text>
            {row.issue.identifier ?? row.issue.issueId} <Text color={ATTENTION_COLOR[a]}>{STATE_PRESENTATION[row.item.state].label}</Text>
            <Text dimColor> · {row.target.repository.repositoryId}</Text>
          </Text>
        );
      })}
      {rows.length > max ? <Text dimColor>+{rows.length - max} more</Text> : null}
    </Box>
  );
}

const HELP: Array<[string, string]> = [
  ["↑↓ / j k", "move"], ["enter / → / l", "drill in"], ["esc / ← / h", "back out"], ["g / G", "top / bottom"],
  ["i / tab", "next inbox item"], [":", "command palette"], ["p", "pause or resume the plan"], ["c", "cancel item or plan (confirm)"],
  ["r", "retry a failed item (confirm)"], ["?", "this help"], ["q", "quit"],
];

/** The bottom area: the active prompt or palette, the last message, recent commands, key hints. */
export function Footer({ mode, message, commands, error }: { mode: Mode; message: string | null; commands: CommandsState; error: string | null }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <ModeView mode={mode} />
      {error ? <Text color="red" wrap="truncate-end">{error}</Text> : null}
      {message ? <Text color="yellow" wrap="truncate-end">{message}</Text> : null}
      {recent(commands, 2).map((e) => <CommandLine key={e.command.commandId} entry={e} />)}
      <Text dimColor wrap="truncate-end">↑↓ move · enter/esc drill · : commands · p pause/resume · c cancel · r retry · i inbox · ? help · q quit</Text>
    </Box>
  );
}

const choiceText = (c: Choice) => `${c.option.label} ${c.target}${c.option.tier > 1 ? `  (tier ${c.option.tier})` : ""}`;

function ModeView({ mode }: { mode: Mode }) {
  switch (mode.kind) {
    case "browse": return null;
    case "help":
      return (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>Keys <Text dimColor>(any key closes)</Text></Text>
          {HELP.map(([k, v]) => <Text key={k}><Text color="cyan">{k.padEnd(16)}</Text>{v}</Text>)}
          <Text dimColor>Tier 1 runs at once, tier 2 asks y/n, tier 3 asks you to type the name.</Text>
        </Box>
      );
    case "palette":
      return (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>Commands <Text dimColor>(enter or 1-{mode.choices.length} to run, esc to close)</Text></Text>
          {mode.choices.map((c, i) => (
            <Text key={i} inverse={i === mode.index} color={c.option.destructive ? "red" : undefined}>{i + 1}. {choiceText(c)}</Text>
          ))}
        </Box>
      );
    case "confirm":
      return (
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text>
            <Text bold color={mode.choice.option.destructive ? "red" : "yellow"}>{mode.choice.option.label} {mode.choice.target}?</Text>
            <Text dimColor> {mode.choice.option.destructive ? "This cannot be undone from Bob. " : ""}The coordinator runs it as you. </Text>
            <Text bold>y/n</Text>
          </Text>
        </Box>
      );
    case "typed":
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
          <Text bold color="red">{mode.choice.option.label} {mode.choice.target}</Text>
          <Text>Type <Text bold>{mode.expected}</Text> to confirm, enter to send, esc to cancel:</Text>
          <Text>&gt; {mode.text}<Text inverse> </Text></Text>
        </Box>
      );
  }
}
