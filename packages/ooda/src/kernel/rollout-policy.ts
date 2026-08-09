import {
  OodaRolloutStageV1Schema,
  type OodaRolloutCapabilityV1,
  type OodaRolloutPolicyV1,
  type OodaRolloutStageV1,
} from "../contracts/v1";

type RolloutEnvironment = Record<string, string | undefined>;

const STAGES: OodaRolloutStageV1[] = [
  "shadow",
  "conversations",
  "mobile_text",
  "tts",
  "jobs",
  "obsidian",
  "durable_work",
  "portfolio_evidence",
  "specialists",
  "reviews_push",
];

const MINIMUM_STAGE: Record<OodaRolloutCapabilityV1, OodaRolloutStageV1> = {
  shadow_projection: "shadow",
  conversation_read: "conversations",
  conversation_write: "conversations",
  mobile_text: "mobile_text",
  tts: "tts",
  agent_jobs: "jobs",
  obsidian_delivery: "obsidian",
  durable_work_delivery: "durable_work",
  portfolio_evidence: "portfolio_evidence",
  specialist_delivery: "specialists",
  reviews: "reviews_push",
  push: "reviews_push",
};

function enabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function configuredStage(env: RolloutEnvironment): OodaRolloutStageV1 {
  const parsed = OodaRolloutStageV1Schema.safeParse(env.OODA_ROLLOUT_STAGE);
  if (parsed.success) return parsed.data;
  return env.NODE_ENV === "production" ? "shadow" : "reviews_push";
}

function ownerAllowlist(env: RolloutEnvironment): Set<string> {
  return new Set(
    (env.OODA_ROLLOUT_OWNER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function resolveOodaRolloutPolicy(
  ownerId: string,
  env: RolloutEnvironment = process.env,
): OodaRolloutPolicyV1 {
  const stage = configuredStage(env);
  const killed = enabled(env.OODA_ROLLOUT_KILL_SWITCH);
  const allowlist = ownerAllowlist(env);
  const production = env.NODE_ENV === "production";
  const eligible =
    !killed &&
    (allowlist.has(ownerId) || (!production && allowlist.size === 0));
  const stageIndex = STAGES.indexOf(stage);
  const capabilities = Object.fromEntries(
    Object.entries(MINIMUM_STAGE).map(([capability, minimum]) => [
      capability,
      capability === "shadow_projection"
        ? !killed
        : eligible && STAGES.indexOf(minimum) <= stageIndex,
    ]),
  ) as OodaRolloutPolicyV1["capabilities"];
  const reasons: string[] = [];
  if (killed) reasons.push("The global OODA rollout kill switch is active.");
  if (!killed && !eligible) {
    reasons.push("This owner is not in the production OODA rollout allowlist.");
  }
  if (!env.OODA_ROLLOUT_STAGE) {
    reasons.push(
      production
        ? "No production rollout stage is configured; shadow mode is the safe default."
        : "No rollout stage is configured; development defaults to the complete capability set.",
    );
  }

  const dogfoodStartedAt = env.OODA_DOGFOOD_STARTED_AT;
  return {
    stage,
    eligible,
    killed,
    capabilities,
    reasons,
    ...(dogfoodStartedAt && !Number.isNaN(Date.parse(dogfoodStartedAt))
      ? { dogfoodStartedAt: new Date(dogfoodStartedAt).toISOString() }
      : {}),
  };
}

export function assertOodaRolloutCapability(
  policy: OodaRolloutPolicyV1,
  capability: OodaRolloutCapabilityV1,
): void {
  if (!policy.capabilities[capability]) {
    throw new Error(
      `OODA rollout capability ${capability} is not enabled at stage ${policy.stage}.`,
    );
  }
}
