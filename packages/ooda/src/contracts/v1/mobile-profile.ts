import { z } from "zod";

import { OodaRolloutCapabilitiesV1Schema } from "./rollout";

/**
 * Mobile compatibility profile v1.
 *
 * One versioned document every production client advertises, and the server
 * answers with. It exists so Bob's mobile app, Hermes, the web surfaces and
 * any future client cannot invent incompatible semantics for the same
 * conversation, job and proposal contracts.
 *
 * Deliberately built on `OodaRolloutCapabilitiesV1` rather than a parallel
 * capability enum: the rollout policy is already the single vocabulary for
 * "what is turned on", and a second list would drift from it within a release.
 * The profile adds the two things rollout does not model — which client
 * versions the server will still talk to, and how complete the answer is.
 *
 * Originally specified in the standalone repo's kernel-convergence plan as a
 * cross-repo artifact. With the repos collapsed it lives beside the contracts
 * it describes and is gated by the same boundary guard, so no publishing step
 * stands between a contract change and the check that catches it.
 */

/** Stable identifier for this profile. Bump the suffix, never mutate v1. */
export const OODA_MOBILE_PROFILE_V1 = "ooda-mobile-v1" as const;

/**
 * How complete the server's answer is.
 *
 * `unknown` must never be coerced to `complete`. A client that cannot tell
 * whether a dependency answered has to say so — silently rendering partial
 * data as whole is the failure this field exists to prevent.
 */
export const ProfileCoverageV1Schema = z.enum([
  "complete",
  "partial",
  "unknown",
]);
export type ProfileCoverageV1 = z.infer<typeof ProfileCoverageV1Schema>;

/**
 * The client-version window the server will serve.
 *
 * Policy is current-and-previous: `maximumClient` is the newest profile the
 * server understands, `minimumClient` the published floor. A client below the
 * floor is rejected; a client above the ceiling is a deploy-order mistake
 * (client shipped before server) and is also rejected rather than guessed at.
 */
export const ProfileCompatibilityV1Schema = z
  .object({
    minimumClient: z.number().int().positive(),
    maximumClient: z.number().int().positive(),
  })
  .strict()
  .refine((c) => c.minimumClient <= c.maximumClient, {
    message: "minimumClient must not exceed maximumClient",
  });
export type ProfileCompatibilityV1 = z.infer<
  typeof ProfileCompatibilityV1Schema
>;

/**
 * The profile document.
 *
 * `.strict()` is load-bearing: unknown keys fail closed. That is what stops a
 * well-meaning client from smuggling conversation text, user identity or any
 * other content-shaped payload into what must stay a capability announcement.
 */
export const OodaMobileProfileV1Schema = z
  .object({
    profile: z.literal(OODA_MOBILE_PROFILE_V1),
    contractVersion: z.literal(1),
    /**
     * Opaque resume cursor. Opaque on purpose — clients must not parse,
     * order or arithmetic on it; the server owns its shape.
     */
    eventCursor: z.string().min(1).max(4_096).optional(),
    capabilities: OodaRolloutCapabilitiesV1Schema,
    compatibility: ProfileCompatibilityV1Schema,
    coverage: ProfileCoverageV1Schema,
  })
  .strict();
export type OodaMobileProfileV1 = z.infer<typeof OodaMobileProfileV1Schema>;

/** What a client sends when it opens a session. */
export const OodaMobileClientHelloV1Schema = z
  .object({
    profile: z.literal(OODA_MOBILE_PROFILE_V1),
    contractVersion: z.number().int().positive(),
    eventCursor: z.string().min(1).max(4_096).optional(),
  })
  .strict();
export type OodaMobileClientHelloV1 = z.infer<
  typeof OodaMobileClientHelloV1Schema
>;

export type ProfileNegotiationV1 =
  | { readonly outcome: "accepted"; readonly contractVersion: number }
  | {
      readonly outcome: "rejected";
      readonly reason: "below_floor" | "above_ceiling" | "wrong_profile";
      readonly detail: string;
    };

/**
 * Decide whether a client's hello is servable.
 *
 * Pure and total so both sides can run it: the server to answer, the client to
 * predict. Rejection carries a reason a human can act on, never a bare false.
 */
export function negotiateMobileProfileV1(
  hello: OodaMobileClientHelloV1,
  server: OodaMobileProfileV1,
): ProfileNegotiationV1 {
  if (hello.profile !== server.profile) {
    return {
      outcome: "rejected",
      reason: "wrong_profile",
      detail: `client advertised "${hello.profile}", server serves "${server.profile}"`,
    };
  }
  if (hello.contractVersion < server.compatibility.minimumClient) {
    return {
      outcome: "rejected",
      reason: "below_floor",
      detail:
        `client contractVersion ${hello.contractVersion} is below the ` +
        `published floor ${server.compatibility.minimumClient}; the client must update`,
    };
  }
  if (hello.contractVersion > server.compatibility.maximumClient) {
    return {
      outcome: "rejected",
      reason: "above_ceiling",
      detail:
        `client contractVersion ${hello.contractVersion} exceeds what the server ` +
        `understands (${server.compatibility.maximumClient}); deploy the server first`,
    };
  }
  return { outcome: "accepted", contractVersion: hello.contractVersion };
}

/**
 * Merge dependency coverage into one answer, worst-case wins.
 *
 * `unknown` dominates `partial`, which dominates `complete`. A caller that
 * aggregates several sources cannot report `complete` because most of them
 * answered.
 */
export function mergeCoverageV1(
  parts: readonly ProfileCoverageV1[],
): ProfileCoverageV1 {
  if (parts.some((p) => p === "unknown")) return "unknown";
  if (parts.some((p) => p === "partial")) return "partial";
  return "complete";
}
