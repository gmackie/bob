"use client";

import React from "react";
import { useEffect, useState } from "react";

import { AgentPanel, SystemStatusPanel, TerminalComponent } from "~/components/dashboard";
import { api } from "~/lib/rest/api";

export function SystemOperations() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingTerminal, setIsLoadingTerminal] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function ensureSystemTerminal() {
      setIsLoadingTerminal(true);
      setError(null);

      try {
        const result = await api.createSystemTerminal();
        if (!cancelled) {
          setSessionId(result.sessionId);
        }
      } catch (terminalError) {
        if (!cancelled) {
          setError(
            terminalError instanceof Error
              ? terminalError.message
              : "Unable to open the system terminal",
          );
          setSessionId(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTerminal(false);
        }
      }
    }

    void ensureSystemTerminal();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <header className="rounded-[2rem] border border-border bg-[linear-gradient(135deg,#0e1728,#09111d)] px-8 py-8">
        <div className="text-xs uppercase tracking-[0.3em] text-white/50">
          System
        </div>
        <h1 className="mt-3 font-display text-4xl font-semibold text-white">Operations Console</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
          Terminal access, agent controls, and host readiness live here without
          pulling planning users back into the old dashboard shell.
        </p>
      </header>

      <section className="overflow-hidden rounded-[1.75rem] border border-border bg-popover">
        <SystemStatusPanel />
      </section>

      <section className="rounded-[1.75rem] border border-border bg-popover p-6 text-foreground">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Terminal
            </div>
            <h2 className="mt-2 font-display text-xl font-semibold">System terminal</h2>
          </div>
          {sessionId ? (
            <button
              type="button"
              className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-muted-foreground/30 hover:text-foreground"
              onClick={() => {
                setSessionId(null);
                setIsLoadingTerminal(false);
              }}
            >
              Close terminal
            </button>
          ) : null}
        </div>

        {sessionId ? (
          <TerminalComponent
            sessionId={sessionId}
            onClose={() => setSessionId(null)}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-secondary px-5 py-8 text-sm text-muted-foreground">
            {isLoadingTerminal ? "Preparing system terminal" : "System terminal closed"}
          </div>
        )}

        {error ? (
          <p className="mt-3 text-sm text-rose-300">{error}</p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-[1.75rem] border border-border bg-popover">
        <div className="border-b border-border px-6 py-4">
          <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Agents
          </div>
          <h2 className="mt-2 font-display text-xl font-semibold text-foreground">
            Agent controls
          </h2>
        </div>
        <AgentPanel
          selectedWorktree={null}
          selectedInstance={null}
          onRestartInstance={async () => {}}
          onStopInstance={async () => {}}
          onStartInstance={async () => {}}
          onDeleteWorktree={async () => {}}
          error={error}
          isLeftPanelCollapsed={false}
        />
      </section>
    </div>
  );
}
