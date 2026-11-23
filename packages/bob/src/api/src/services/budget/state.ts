/**
 * BOB-76: builds the budget read model from the database and runs the
 * governor on it. Used by autoDrain (every tick) and the budget RPC (the
 * dashboard), so both see the same snapshot and the same verdict.
 */
import { inArray, readBudgetPolicy, readBudgetStateRows, recordBudgetDecision, sql  } from "@bob/db";
import type {BudgetStateRows} from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations } from "@bob/db/schema";
import { governState, normalizeBudgetPolicy    } from "@bob/ws";
import type {BudgetPolicy, BudgetStateWire, BudgetVerdict} from "@bob/ws";

import { ACTIVE_SESSION_STATUSES } from "../automation/activeSessions.js";

/** Bob agent types whose subscriptions sit behind the proxy, and their provider ids. */
export const AGENT_PROVIDER: Record<string, string> = { claude: "claude", codex: "codex", grok: "grok", kimi: "kimi" };

const tokensOf = (row: { inputTokens: number; outputTokens: number; reasoningTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number }) => ({
  input: Number(row.inputTokens),
  output: Number(row.outputTokens),
  reasoning: Number(row.reasoningTokens),
  cacheRead: Number(row.cacheReadTokens),
  cacheCreation: Number(row.cacheCreationTokens),
  total: Number(row.totalTokens),
});

/** Pure: database rows → the wire snapshot. */
export function rowsToBudgetState(rows: BudgetStateRows, policy: BudgetPolicy, activeByProvider: Record<string, number>, now: Date): BudgetStateWire {
  return {
    at: now.toISOString(),
    policy,
    accounts: rows.accounts
      .map((a) => ({
        accountId: a.accountId,
        provider: a.provider,
        label: a.label,
        status: a.status,
        ...(a.detail ? { detail: a.detail } : {}),
        ...(a.authIndex ? { authIndex: a.authIndex } : {}),
        updatedAt: a.updatedAt.toISOString(),
      }))
      .sort((x, y) => x.provider.localeCompare(y.provider) || x.accountId.localeCompare(y.accountId)),
    meters: rows.meters.map((m) => ({
      accountId: m.accountId,
      window: m.windowName,
      ...(m.windowMinutes ? { windowMinutes: m.windowMinutes } : {}),
      usedPercent: Number(m.usedPercent),
      ...(m.resetsAt ? { resetsAt: m.resetsAt.toISOString() } : {}),
      ...(m.status ? { status: m.status } : {}),
      observedAt: m.observedAt.toISOString(),
    })),
    ledger: rows.ledger
      .filter((l) => l.source === "bob" || l.source === "interactive")
      .map((l) => ({
        hour: l.hour.toISOString(),
        authIndex: l.authIndex,
        provider: l.provider,
        model: l.model,
        source: l.source as "bob" | "interactive",
        requests: l.requests,
        failed: l.failed,
        tokens: tokensOf(l),
      })),
    sessions: rows.sessions.map((s) => ({
      sessionId: s.sessionId,
      authIndex: s.authIndex,
      provider: s.provider,
      model: s.model,
      requests: s.requests,
      tokens: tokensOf(s),
      firstAt: s.firstAt.toISOString(),
      lastAt: s.lastAt.toISOString(),
    })),
    activeByProvider,
  };
}

export async function activeRunsByProvider(): Promise<Record<string, number>> {
  const rows = await db
    .select({ agent: chatConversations.agentType, n: sql<number>`count(*)::int` })
    .from(chatConversations)
    .where(inArray(chatConversations.status, ACTIVE_SESSION_STATUSES))
    .groupBy(chatConversations.agentType);
  const out: Record<string, number> = {};
  for (const row of rows) {
    const provider = row.agent ? AGENT_PROVIDER[row.agent] : undefined;
    if (provider) out[provider] = (out[provider] ?? 0) + Number(row.n);
  }
  return out;
}

export async function loadBudgetState(now = new Date()): Promise<BudgetStateWire> {
  const [rows, stored, active] = await Promise.all([readBudgetStateRows(db, { now }), readBudgetPolicy(db), activeRunsByProvider()]);
  return rowsToBudgetState(rows, normalizeBudgetPolicy(stored?.policy), active, now);
}

export interface BudgetEvaluation {
  state: BudgetStateWire;
  verdict: BudgetVerdict;
}

export async function evaluateBudget(now = new Date()): Promise<BudgetEvaluation> {
  const state = await loadBudgetState(now);
  const { verdict } = governState(state, now);
  return { state, verdict };
}

/** Best-effort audit row for one tick; never throws. */
export async function recordDecision(evaluation: BudgetEvaluation, legacyBudget: number): Promise<void> {
  const { verdict, state } = evaluation;
  await recordBudgetDecision(db, {
    enforce: verdict.enforce,
    mode: verdict.mode,
    totalSlots: verdict.totalSlots,
    legacyBudget,
    verdict: verdict as unknown as Record<string, unknown>,
    inputs: {
      activeByProvider: state.activeByProvider,
      accounts: state.accounts.map((a) => ({ accountId: a.accountId, provider: a.provider, status: a.status })),
      policy: state.policy,
    },
  }).catch((error) => console.warn("[budget] decision not recorded:", error instanceof Error ? error.message : error));
}

/**
 * Under enforcement: the agent to give the next item to — the governed
 * provider with the most remaining slots. Ungoverned agents are not offered.
 */
export function nextBudgetedAgent(agents: readonly string[], remaining: Map<string, number>): string | undefined {
  let best: { agent: string; slots: number } | undefined;
  for (const agent of agents) {
    const provider = AGENT_PROVIDER[agent];
    const slots = provider ? (remaining.get(provider) ?? 0) : 0;
    if (slots > 0 && (!best || slots > best.slots)) best = { agent, slots };
  }
  return best?.agent;
}
