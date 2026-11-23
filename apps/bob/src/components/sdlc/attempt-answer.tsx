"use client";

import { useState } from "react";
import type { PendingInput } from "@bob/sdlc-view";

import { Button } from "@gmacko/core/ui/button";
import { cn } from "@gmacko/core/ui";

import { draftAnswers, emptyDraft, optionValue, resolveInputCommand, setText, toggleOption, type AnswerDraft } from "./attempt-model";
import { answerFormStatus, type ActionContext } from "./commands-model";
import type { SendCommand } from "./use-sdlc-edge";

/**
 * Answers an agent's pending question (ResolveInput, tier 1, no confirmation). One field
 * per question: radios for a single choice, checkboxes for multiSelect, a text box when
 * the question has no options. Disabled while a command for the item is in flight.
 * Mount it with key={pending.promptId} so a new prompt starts a fresh draft.
 */
export function AnswerForm({ itemId, pending, context, send, initialDraft }: {
  itemId: string;
  pending: PendingInput;
  context: ActionContext;
  send: SendCommand;
  initialDraft?: AnswerDraft;
}) {
  const [draft, setDraft] = useState<AnswerDraft>(() => initialDraft ?? emptyDraft(pending));
  const [touched, setTouched] = useState(false);
  const { answers, errors } = draftAnswers(pending, draft);
  const status = answerFormStatus(context, itemId);

  return (
    <form
      aria-label="Answer pending input"
      className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!answers || status.disabled) return;
        send(resolveInputCommand(itemId, pending, answers), "Answer");
      }}
    >
      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">The agent is waiting for your answer.</p>
      {pending.questions.map((q) => {
        const d = draft[q.id] ?? { selected: [], text: "" };
        const error = touched ? errors[q.id] : undefined;
        const name = `q-${pending.promptId}-${q.id}`;
        return (
          <fieldset key={q.id} className="space-y-1.5" disabled={status.disabled}>
            <legend className="text-sm">
              {q.header && <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{q.header}</span>}
              {q.question}
            </legend>
            {q.options.length === 0 ? (
              <textarea
                aria-label={q.question}
                className="block min-h-16 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={d.text}
                maxLength={4000}
                onChange={(e) => setDraft(setText(draft, q, e.target.value))}
              />
            ) : (
              <div className="space-y-1">
                {q.options.map((o) => {
                  const value = optionValue(o);
                  return (
                    <label key={value} className="flex items-start gap-2 text-sm">
                      <input
                        type={q.multiSelect ? "checkbox" : "radio"}
                        name={name}
                        value={value}
                        className="mt-1"
                        checked={d.selected.includes(value)}
                        onChange={() => setDraft(toggleOption(draft, q, value))}
                      />
                      <span>
                        {o.label}
                        {o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </fieldset>
        );
      })}
      {touched && errors._ && <p className="text-xs text-destructive">{errors._}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={status.disabled || (touched && !answers)} title={status.reason ?? undefined}>
          Send answer
        </Button>
        {status.reason && !status.latest && <span className="text-xs text-muted-foreground">{status.reason}</span>}
      </div>
      {status.latest && (
        <p
          role="status"
          data-status={status.latest.status}
          className={cn(
            "text-xs",
            status.latest.status === "succeeded" && "text-emerald-700 dark:text-emerald-400",
            (status.latest.status === "failed" || status.latest.status === "rejected") && "text-destructive",
            status.pending && "text-muted-foreground",
          )}
        >
          {status.text}
        </p>
      )}
    </form>
  );
}
