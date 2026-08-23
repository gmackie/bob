/**
 * Golden corpus for the mobile compatibility profile v1.
 *
 * Every fixture is sanitized: capability announcements and negotiation
 * envelopes only. No conversation text, no identity, no paths, no tokens —
 * `mobile-profile.test.ts` asserts that mechanically, because the cheapest way
 * for content to leak into telemetry is a fixture author reaching for a
 * realistic-looking example.
 *
 * The corpus deliberately carries the failure cases alongside the happy path.
 * A corpus of only happy paths passes forever and catches nothing; the states
 * worth pinning are the degraded ones — partial coverage, unknown coverage, a
 * client below the floor, a client ahead of the server.
 */
import type {
  OodaMobileClientHelloV1,
  OodaMobileProfileV1,
} from "../mobile-profile";
import { OODA_MOBILE_PROFILE_V1 } from "../mobile-profile";

const ALL_ON = {
  shadow_projection: true,
  conversation_read: true,
  conversation_write: true,
  mobile_text: true,
  tts: true,
  agent_jobs: true,
  obsidian_delivery: true,
  durable_work_delivery: true,
  portfolio_evidence: true,
  specialist_delivery: true,
  reviews: true,
  push: true,
} as const;

/**
 * A staged rollout with the write lanes dark. This is the shape that must stay
 * servable: disabling one capability cannot collapse chat, so `conversation_read`
 * survives while `conversation_write`, `tts` and `agent_jobs` are off.
 */
const READ_ONLY = {
  ...ALL_ON,
  conversation_write: false,
  tts: false,
  agent_jobs: false,
  durable_work_delivery: false,
  obsidian_delivery: false,
  specialist_delivery: false,
  reviews: false,
} as const;

const serverProfile = {
  /** Everything on, every dependency answered. */
  complete: {
    profile: OODA_MOBILE_PROFILE_V1,
    contractVersion: 1,
    eventCursor: "opaque-cursor-1",
    capabilities: ALL_ON,
    compatibility: { minimumClient: 1, maximumClient: 1 },
    coverage: "complete",
  },
  /** Write lanes dark mid-rollout; a dependency answered incompletely. */
  degraded: {
    profile: OODA_MOBILE_PROFILE_V1,
    contractVersion: 1,
    eventCursor: "opaque-cursor-2",
    capabilities: READ_ONLY,
    compatibility: { minimumClient: 1, maximumClient: 2 },
    coverage: "partial",
  },
  /**
   * A dependency did not answer at all. Distinct from `partial` on purpose:
   * the client must not render this as whole data, and must not silently
   * upgrade it to `complete` once one source recovers.
   */
  unknown: {
    profile: OODA_MOBILE_PROFILE_V1,
    contractVersion: 1,
    capabilities: READ_ONLY,
    compatibility: { minimumClient: 1, maximumClient: 2 },
    coverage: "unknown",
  },
} satisfies Record<string, OodaMobileProfileV1>;

type NegotiationFixture = {
  readonly hello: OodaMobileClientHelloV1;
  readonly server: OodaMobileProfileV1;
  readonly expected:
    | { readonly outcome: "accepted" }
    | {
        readonly outcome: "rejected";
        readonly reason: "below_floor" | "above_ceiling" | "wrong_profile";
      };
};

const negotiation = {
  currentClient: {
    hello: { profile: OODA_MOBILE_PROFILE_V1, contractVersion: 1 },
    server: serverProfile.complete,
    expected: { outcome: "accepted" },
  },
  /** Current-and-previous: last release must keep working through a rollout. */
  previousClient: {
    hello: { profile: OODA_MOBILE_PROFILE_V1, contractVersion: 1 },
    server: serverProfile.degraded,
    expected: { outcome: "accepted" },
  },
  belowFloor: {
    hello: { profile: OODA_MOBILE_PROFILE_V1, contractVersion: 1 },
    server: {
      ...serverProfile.complete,
      compatibility: { minimumClient: 2, maximumClient: 3 },
    },
    expected: { outcome: "rejected", reason: "below_floor" },
  },
  /** Client shipped ahead of server — reject rather than guess. */
  aboveCeiling: {
    hello: { profile: OODA_MOBILE_PROFILE_V1, contractVersion: 4 },
    server: serverProfile.complete,
    expected: { outcome: "rejected", reason: "above_ceiling" },
  },
} satisfies Record<string, NegotiationFixture>;

export const MOBILE_V1_CORPUS = { serverProfile, negotiation } as const;

/**
 * Mutation probes: each takes the canonical profile and adds one key that must
 * fail closed. These are the shapes a client might plausibly try to attach —
 * a message, a user, a device id, a stack trace — and every one is content
 * that has no business in a capability announcement.
 */
export function forbiddenFieldProbes(): ReadonlyArray<
  readonly [string, Record<string, unknown>]
> {
  const base = serverProfile.complete as Record<string, unknown>;
  const probes: Record<string, unknown> = {
    conversationText: "why is the deploy failing",
    userId: "user-1",
    deviceId: "device-1",
    stackTrace: "Error: boom",
    debug: { verbose: true },
    extra: null,
  };
  return Object.entries(probes).map(
    ([key, value]) => [key, { ...base, [key]: value }] as const,
  );
}
