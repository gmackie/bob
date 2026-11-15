import { Box, Text } from "ink";
import type { CiMessage, ItemSnapshot } from "@bob/sdlc-view";

import { currentQuestion, optionValue, tailLines, tailView, type AnswerFlow, type AttemptState } from "../model/attempt";

const CI_MARK: Record<string, { mark: string; color: string }> = {
  queued: { mark: "○", color: "gray" }, running: { mark: "◐", color: "yellow" }, passed: { mark: "✓", color: "green" },
  failed: { mark: "✗", color: "red" }, skipped: { mark: "–", color: "gray" }, unknown: { mark: "?", color: "gray" },
};

/**
 * The attempt level (L5) under an item: T3 thread ids, the live tail (the last `maxTail`
 * lines), CI phases, and "live detail unavailable" when the relay or ForgeGraph is silent.
 */
export function AttemptPane({ item, attempt, maxTail }: { item: ItemSnapshot; attempt: AttemptState; maxTail: number }) {
  const execution = item.execution;
  if (!execution) return <Text dimColor>No execution admitted yet.</Text>;
  const { thread } = execution;
  const tail = tailView(attempt, item);
  const frame = tail.kind === "waiting" ? null : tail.frame;
  const lines = tailLines(frame, maxTail);
  const ci = attempt.ci[item.itemId];
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">Attempt <Text color="cyan">{execution.attemptId}</Text>{frame ? <Text dimColor> · thread {frame.threadStatus}</Text> : null}</Text>
      <Text wrap="truncate-end">
        Thread <Text color="cyan">t3:{thread.threadId}</Text>
        <Text dimColor> (env {thread.environmentId}, project {thread.projectId}{thread.turnId ? `, turn ${thread.turnId}` : ""})</Text>
      </Text>
      {item.state === "waiting-input" && item.pendingInput ? (
        <Text color="yellow" wrap="truncate-end">? Waiting for your answer ({item.pendingInput.questions.length} question{item.pendingInput.questions.length === 1 ? "" : "s"}) · press a</Text>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text bold>Live tail</Text>
          {tail.kind === "live" ? <Text color="green"> ● live</Text> : null}
        </Text>
        {tail.kind === "unavailable" ? <Text color="yellow" wrap="truncate-end">live detail unavailable: {tail.reason}</Text> : null}
        {tail.kind === "waiting" ? <Text dimColor>waiting for live detail…</Text> : null}
        {lines.map((line, i) => <Text key={i} dimColor={tail.kind === "unavailable"} wrap="truncate-end">  {line}</Text>)}
      </Box>
      <CiLines ci={ci} />
    </Box>
  );
}

function CiLines({ ci }: { ci: CiMessage | undefined }) {
  if (!ci) return <Text dimColor>CI · no detail yet</Text>;
  if (!ci.available) return <Text color="yellow" wrap="truncate-end">CI · unavailable: {ci.reason}</Text>;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">CI · {ci.summary} <Text dimColor>{ci.sha.slice(0, 10)}</Text></Text>
      <Text wrap="truncate-end">
        {ci.phases.map((p, i) => {
          const m = CI_MARK[p.status] ?? CI_MARK.unknown!;
          return <Text key={i}><Text color={m.color}>{m.mark}</Text> {p.name}  </Text>;
        })}
      </Text>
    </Box>
  );
}

/** The answer flow's prompt in the footer: one question at a time. */
export function AnswerPrompt({ flow }: { flow: AnswerFlow }) {
  const q = currentQuestion(flow);
  const d = flow.draft[q.id] ?? { selected: [], text: "" };
  const total = flow.pending.questions.length;
  const last = flow.step === total - 1;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow" wrap="truncate-end">Answer {flow.target} · question {flow.step + 1}/{total}{q.header ? ` · ${q.header}` : ""}</Text>
      <Text wrap="wrap">{q.question}</Text>
      {q.options.length > 0 ? (
        q.options.map((o, i) => {
          const value = optionValue(o);
          const on = d.selected.includes(value);
          const mark = q.multiSelect ? (on ? "[x]" : "[ ]") : on ? "(•)" : "( )";
          return (
            <Text key={value} inverse={i === flow.cursor} wrap="truncate-end">
              {i + 1}. {mark} {o.label}{o.description ? <Text dimColor> · {o.description}</Text> : null}
            </Text>
          );
        })
      ) : (
        <Text>&gt; {d.text}<Text inverse> </Text></Text>
      )}
      {flow.error ? <Text color="red" wrap="truncate-end">{flow.error}</Text> : null}
      <Text dimColor wrap="truncate-end">
        {q.options.length > 0
          ? `↑↓ move · ${q.multiSelect ? "space toggles · " : "space picks · "}enter ${last ? "sends" : "next"}`
          : `type · enter ${last ? "sends" : "next"}`}
        {flow.step > 0 ? " · shift-tab back" : ""} · esc cancel
      </Text>
    </Box>
  );
}
