"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { AuthedOnly, useRpcClient } from "@gmacko/app-shell";

interface CapturedEvent {
  readonly t: number;
  readonly evt: unknown;
}

function AgentInner() {
  const client = useRpcClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState<CapturedEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const createSession = useMutation({
    mutationFn: () => client.agent.createSession({ adapterId: "claude-code" }),
    onSuccess: ({ conversationId }) => {
      setConversationId(conversationId);
      setEvents([]);
    },
  });

  async function sendTurn() {
    if (!conversationId || !prompt) return;
    setIsStreaming(true);
    try {
      for await (const evt of client.agent.sendTurn({ conversationId, prompt })) {
        setEvents((prev) => [...prev, { t: Date.now(), evt }]);
      }
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <main style={{ maxWidth: "800px", margin: "2rem auto", padding: "1rem" }}>
      <h1>Agent</h1>

      <section>
        <h2>Session</h2>
        {conversationId ? (
          <p>
            Active: <code>{conversationId}</code>
          </p>
        ) : (
          <button onClick={() => createSession.mutate()} disabled={createSession.isPending}>
            Create session
          </button>
        )}
      </section>

      {conversationId && (
        <section>
          <h2>Send turn</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendTurn();
            }}
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Prompt…"
              rows={3}
              style={{ width: "100%" }}
            />
            <button type="submit" disabled={isStreaming || !prompt}>
              {isStreaming ? "Streaming…" : "Send"}
            </button>
          </form>
        </section>
      )}

      {events.length > 0 && (
        <section>
          <h2>Events ({events.length})</h2>
          <ol>
            {events.map((e, i) => (
              <li key={i}>
                <code>{JSON.stringify(e.evt)}</code>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

export default function AgentPage() {
  return (
    <AuthedOnly>
      <AgentInner />
    </AuthedOnly>
  );
}
