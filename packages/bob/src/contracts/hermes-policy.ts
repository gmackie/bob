import type {
  HermesOperatorChannel,
  HermesOperatorIntentName,
} from "./schemas/hermes-operator.js";

export type HermesRiskClass = "R0" | "R1" | "R2" | "R3" | "R4";
export type HermesOwningSystem = "ooda" | "bob" | "skillfleet";
export type HermesIntentEffect =
  | "read-only"
  | "accepted-user-write"
  | "private-bounded-work"
  | "proposal-only"
  | "approval-only"
  | "read-or-dry-run-proposal"
  | "private-reflection"
  | "emergency-control";

export interface HermesIntentPolicy {
  owner: HermesOwningSystem;
  riskClass: HermesRiskClass;
  effect: HermesIntentEffect;
  channels: readonly HermesOperatorChannel[];
}

const ALL_CHANNELS = ["telegram", "console", "bob"] as const;

export const HERMES_INTENT_POLICIES = {
  today: { owner: "bob", riskClass: "R0", effect: "read-only", channels: ALL_CHANNELS },
  capture: {
    owner: "ooda",
    riskClass: "R1",
    effect: "accepted-user-write",
    channels: ALL_CHANNELS,
  },
  research: {
    owner: "ooda",
    riskClass: "R1",
    effect: "private-bounded-work",
    channels: ALL_CHANNELS,
  },
  work: {
    owner: "bob",
    riskClass: "R2",
    effect: "proposal-only",
    channels: ALL_CHANNELS,
  },
  approve: {
    owner: "bob",
    riskClass: "R3",
    effect: "approval-only",
    channels: ALL_CHANNELS,
  },
  status: { owner: "bob", riskClass: "R0", effect: "read-only", channels: ALL_CHANNELS },
  fleet: {
    owner: "skillfleet",
    riskClass: "R0",
    effect: "read-or-dry-run-proposal",
    channels: ALL_CHANNELS,
  },
  close: {
    owner: "ooda",
    riskClass: "R0",
    effect: "private-reflection",
    channels: ALL_CHANNELS,
  },
  stop: {
    owner: "bob",
    riskClass: "R3",
    effect: "emergency-control",
    channels: ALL_CHANNELS,
  },
} as const satisfies Record<HermesOperatorIntentName, HermesIntentPolicy>;

export function getHermesIntentPolicy(
  intent: HermesOperatorIntentName,
  channel: HermesOperatorChannel,
): HermesIntentPolicy {
  const policy = HERMES_INTENT_POLICIES[intent];
  if (!(policy.channels as readonly HermesOperatorChannel[]).includes(channel)) {
    throw new Error(`Hermes intent ${intent} is unavailable on ${channel}`);
  }
  return policy;
}
