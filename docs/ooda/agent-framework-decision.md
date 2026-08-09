# OODA agent-framework boundary

Status: accepted on 2026-08-09

## Decision

OODA’s Personal-OS kernel remains framework-neutral. Its conversation events,
memory, disclosure decisions, capabilities, proposals, approval ledger,
idempotent outbox, and external receipts are canonical. An agent framework may
run inside an `AgentAdapter`; it may not become a second conversation store,
approval authority, integration ledger, or durable-work dispatcher.

The first production milestone continues to use the existing native runtime
adapters for Codex app-server, `claude -p`, and Grok CLI/ACP. This preserves the
user’s subscription-backed accounts and provider session identifiers instead
of silently converting work to metered API calls.

Strands is the preferred framework for a later bounded experiment. The
experiment is limited to metered, disposable `read_only_research` jobs behind
the existing adapter boundary. LangGraph is reserved for a later durable
workflow experiment only if OODA’s job-event and outbox machinery proves
insufficient. LangChain’s high-level agent abstraction is not adopted into the
kernel.

## Why

Strands now has a TypeScript SDK with streaming, structured output, typed tools,
MCP, hooks, and graph/swarm orchestration. It also exposes a custom model
interface, so it can fit behind OODA rather than forcing OODA behind it.
However, the TypeScript provider matrix does not currently include xAI, its
provider abstractions are API-oriented rather than subscription-CLI session
harnesses, and omitting its sandbox runs file and command tools directly on the
host. Those constraints make it useful for bounded experiments, not as OODA’s
trust kernel. See the official [TypeScript quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript/),
[provider matrix](https://strandsagents.com/docs/user-guide/concepts/model-providers/),
[custom provider contract](https://strandsagents.com/docs/user-guide/concepts/model-providers/custom_model_provider/),
and [sandbox warning](https://strandsagents.com/docs/user-guide/concepts/sandbox/).

LangGraph’s durable execution, checkpoints, interrupts, and streaming overlap
substantially with capabilities OODA already owns. Adopting its checkpointer as
canonical would create two thread identities and two recovery histories. A
future experiment may map one LangGraph run to one OODA `agent_job`, with every
checkpoint surfaced as an OODA job event and no direct destination writes. See
the official [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview),
[persistence model](https://docs.langchain.com/oss/javascript/langgraph/persistence),
and [interrupt semantics](https://docs.langchain.com/oss/javascript/langgraph/interrupts).

## Strands experiment contract

The experiment may proceed only when all of these are true:

- It implements `AgentAdapter` and uses OODA’s existing job budgets,
  cancellation signal, scratch sandbox, capability grants, and credential
  broker.
- It is feature-flagged per job and defaults off.
- It accepts only policy-disclosed context packs and metered credentials for
  the selected provider.
- Its streamed model, tool, lifecycle, and error records map to versioned OODA
  `agent_job_events` without maintaining a parallel durable conversation.
- It cannot create proposals, approve them, write integrations, or dispatch
  Bob work directly.
- A comparison fixture proves equivalent cancellation, timeout, credential
  scrubbing, path isolation, idempotency, and structured findings to the native
  adapter.

Promotion requires a measured improvement in at least one of structured-output
reliability, tool-loop correctness, or implementation simplicity without a
regression in latency, subscription use, privacy, recoverability, or operator
inspectability.

## Revisit triggers

Reconsider this decision when Strands TypeScript supports the required xAI
path or a tested custom CLI-backed model, when a real OODA workflow needs
durable nested graph resumption beyond `agent_jobs`, or when maintaining the
native tool loop costs more than the framework boundary. Any adoption still
preserves OODA’s canonical events and approval ledger.
