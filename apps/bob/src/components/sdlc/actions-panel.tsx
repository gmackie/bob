"use client";

import { useState } from "react";
import type { CommandOption } from "@bob/sdlc-view";

import { Button } from "@gmacko/core/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@gmacko/core/ui/dialog";
import { Input } from "@gmacko/core/ui/input";
import { cn } from "@gmacko/core/ui";

import {
  actionButtons,
  confirmationFor,
  confirmPrompt,
  globalDisabledReason,
  isInFlight,
  latestFor,
  outcomeText,
  type ActionContext,
} from "./commands-model";
import type { SendCommand } from "./use-sdlc-edge";

/**
 * The coordinator actions for one plan or item: tier 1 runs on click, tier 2 asks to
 * confirm, tier 3 asks to type the expected text. The latest command for the resource
 * shows below the buttons, pending with a spinner, then its outcome.
 */
export function ActionsPanel({ label, resourceId, options, target, context, send }: {
  label: string;
  resourceId: string;
  options: CommandOption[];
  /** What the confirm dialog names after the option label, e.g. "BOB-71 in plan 1a2b3c4d". */
  target: string;
  context: ActionContext;
  send: SendCommand;
}) {
  const [confirming, setConfirming] = useState<CommandOption | null>(null);
  const [typed, setTyped] = useState("");
  const buttons = actionButtons(options, context);
  const latest = latestFor(context.commands, resourceId);
  const offline = globalDisabledReason(context);
  if (buttons.length === 0 && !latest) return null;

  const run = (option: CommandOption, typedText = "") => {
    const confirm = confirmationFor(option, typedText);
    if (confirm === null) return;
    send(option.command, option.label, confirm);
  };
  const click = (option: CommandOption) => {
    if (option.tier === 1) run(option);
    else { setTyped(""); setConfirming(option); }
  };
  const prompt = confirming ? confirmPrompt(confirming, target) : null;
  const canConfirm = !!confirming && confirmationFor(confirming, typed) !== null;

  return (
    <section aria-label={label} className="mt-4 border-t border-border pt-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
      {buttons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {buttons.map((b) => (
            <Button
              key={b.key}
              type="button"
              size="sm"
              variant={b.option.destructive ? "destructive" : "outline"}
              disabled={b.disabled}
              title={b.reason ?? undefined}
              onClick={() => click(b.option)}
            >
              {b.option.label}
            </Button>
          ))}
        </div>
      )}
      {offline && buttons.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{offline}</p>}
      {latest && (
        <p
          role="status"
          data-status={latest.status}
          className={cn(
            "mt-2 flex items-center gap-2 text-xs",
            latest.status === "succeeded" && "text-emerald-700 dark:text-emerald-400",
            (latest.status === "failed" || latest.status === "rejected") && "text-destructive",
            isInFlight(latest) && "text-muted-foreground",
          )}
        >
          {isInFlight(latest) && (
            <span aria-hidden className="h-3 w-3 shrink-0 animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground" />
          )}
          {outcomeText(latest)}
        </p>
      )}

      <Dialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        {confirming && prompt && (
          <DialogContent className="max-w-md">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!canConfirm) return;
                run(confirming, typed);
                setConfirming(null);
              }}
            >
              <DialogHeader>
                <DialogTitle>{prompt.title}</DialogTitle>
                <DialogDescription>{prompt.body}</DialogDescription>
              </DialogHeader>
              {prompt.expected !== null && (
                <label className="mt-4 block text-sm">
                  Type <span className="font-mono font-semibold">{prompt.expected}</span> to confirm
                  <Input className="mt-1.5 font-mono" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
                </label>
              )}
              <DialogFooter className="mt-6">
                <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>Keep it</Button>
                <Button type="submit" variant={prompt.destructive ? "destructive" : "default"} disabled={!canConfirm}>
                  {prompt.confirmLabel}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
