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
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
      <header className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#0e1728,#09111d)] px-8 py-8 text-white">
        <div className="text-xs uppercase tracking-[0.3em] text-white/40">
          System
        </div>
        <h1 className="mt-3 text-4xl font-semibold">Operations Console</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">
          Terminal access, agent controls, and host readiness live here without
          pulling planning users back into the old dashboard shell.
        </p>
      </header>

      <section className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#08111d]">
        <SystemStatusPanel />
      </section>

      <section className="rounded-[1.75rem] border border-white/10 bg-[#0b1320] p-6 text-white">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-white/35">
              Terminal
            </div>
            <h2 className="mt-2 text-xl font-semibold">System terminal</h2>
          </div>
          {sessionId ? (
            <button
              type="button"
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/30 hover:text-white"
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
          <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-5 py-8 text-sm text-white/55">
            {isLoadingTerminal ? "Preparing system terminal" : "System terminal closed"}
          </div>
        )}

        {error ? (
          <p className="mt-3 text-sm text-rose-300">{error}</p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#08111d]">
        <div className="border-b border-white/10 px-6 py-4">
          <div className="text-xs uppercase tracking-[0.28em] text-white/35">
            Agents
          </div>
          <h2 className="mt-2 text-xl font-semibold text-white">
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
    </main>
  );
}
