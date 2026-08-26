import { validateApiKey } from "@bob/auth";
import {
  workItemsGet,
  workItemsList,
  workItemStatusCounts,
} from "@bob/api/handlers/workItems";
import { createHermesUsageStore } from "@bob/db";
import { db } from "@bob/db/client";

import {
  createBobWorkBriefReader,
  createBobWorkStatusReader,
  createBobEveningCloseReader,
  createForgeGraphBriefReader,
  createHermesEveningCloseReader,
  createOodaBriefReader,
  createSkillfleetBriefReader,
  HERMES_ACTIVE_BOB_WORK_STATUSES,
} from "~/lib/hermes-briefing-readers";
import { createHermesOperatorRuntime } from "~/lib/hermes-operator-runtime";
import {
  handleHermesOperatorRequest,
  HermesOperatorUnavailableError,
} from "~/lib/hermes-operator-route";
import { withApiRateLimit } from "~/lib/rest/api-helpers";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function postOperator(request: Request): Promise<Response> {
  return handleHermesOperatorRequest(request, {
    authenticate: validateApiKey,
    authorize: (auth) => {
      const ownerUserId = process.env.HERMES_OPERATOR_OWNER_USER_ID;
      return !ownerUserId || auth.userId === ownerUserId;
    },
    createService: (auth) => {
      try {
        const workspaceId = process.env.HERMES_BOB_WORKSPACE_ID;
        const skillfleetOrigin = process.env.SKILLFLEET_ORIGIN_URL;
        const skillfleetReadSecret = process.env.SKILLFLEET_HERMES_READ_SECRET;
        const skillfleetAccessClientId = process.env.SKILLFLEET_ACCESS_CLIENT_ID;
        const skillfleetAccessClientSecret = process.env.SKILLFLEET_ACCESS_CLIENT_SECRET;
        const forgeGraphOrigin = process.env.FORGEGRAPH_API_URL;
        const forgeGraphApiKey = process.env.FORGEGRAPH_API_KEY;
        const oodaOrigin = requiredEnv("HERMES_OODA_ORIGIN_URL");
        const oodaApiKey = requiredEnv("HERMES_OODA_API_KEY");
        const conversationId = requiredEnv("HERMES_OODA_CONVERSATION_ID");
        const branchId = requiredEnv("HERMES_OODA_BRANCH_ID");
        const oodaReader = createOodaBriefReader({
          origin: oodaOrigin,
          apiKey: oodaApiKey,
          conversationId,
          branchId,
          now: () => new Date(),
        });
        const skillfleetReader = skillfleetOrigin && skillfleetReadSecret
            && skillfleetAccessClientId && skillfleetAccessClientSecret
          ? createSkillfleetBriefReader({
              origin: skillfleetOrigin,
              readSecret: skillfleetReadSecret,
              accessClientId: skillfleetAccessClientId,
              accessClientSecret: skillfleetAccessClientSecret,
            })
          : null;
        const forgeGraphReader = forgeGraphOrigin && forgeGraphApiKey
          ? createForgeGraphBriefReader({
              origin: forgeGraphOrigin,
              apiKey: forgeGraphApiKey,
              appSlugs: (process.env.FORGEGRAPH_CONTEXT_APPS
                ?? "ooda,bob,bizpulse,kanbanger")
                .split(","),
              now: () => new Date(),
            })
          : null;
        const bobCloseReader = workspaceId
          ? createBobEveningCloseReader({
              now: () => new Date(),
              listChanged: () => workItemsList(
                { db, userId: auth.userId },
                {
                  workspaceId,
                  statuses: ["completed", "done", "blocked", "in_review", "pending"],
                  limit: 101,
                },
              ),
            })
          : null;
        return createHermesOperatorRuntime(
          {
            ownerUserId: requiredEnv("HERMES_OPERATOR_OWNER_USER_ID"),
            oodaOrigin,
            oodaApiKey,
            conversationId,
            branchId,
            digestSecret: requiredEnv("HERMES_USAGE_DIGEST_SECRET"),
          },
          {
            usage: createHermesUsageStore(db),
            statusReader: createBobWorkStatusReader({
              now: () => new Date(),
              getById: (id) => workItemsGet({ db, userId: auth.userId }, { id }),
            }),
            ...(bobCloseReader
              ? {
                  closeReader: createHermesEveningCloseReader({
                    now: () => new Date(),
                    bob: bobCloseReader,
                    ooda: oodaReader,
                    supportingSources: {
                      ...(skillfleetReader ? { skillfleet: skillfleetReader } : {}),
                      ...(forgeGraphReader ? { forgegraph: forgeGraphReader } : {}),
                    },
                  }),
                }
              : {}),
            briefingSources: {
              ooda: oodaReader,
              ...(workspaceId
                ? {
                    bob: createBobWorkBriefReader({
                      now: () => new Date(),
                      countActive: () =>
                        workItemStatusCounts(
                          { db, userId: auth.userId },
                          { workspaceId },
                        ),
                      listActive: () =>
                        workItemsList(
                          { db, userId: auth.userId },
                          {
                            workspaceId,
                            statuses: [...HERMES_ACTIVE_BOB_WORK_STATUSES],
                            limit: 5,
                          },
                        ),
                    }),
                  }
                : {}),
              ...(skillfleetReader ? { skillfleet: skillfleetReader } : {}),
              ...(forgeGraphReader ? { forgegraph: forgeGraphReader } : {}),
            },
          },
        ).createService(auth);
      } catch (error) {
        console.error("[hermes-operator] runtime unavailable", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
        throw new HermesOperatorUnavailableError();
      }
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApiRateLimit(
    request,
    () => postOperator(request),
    "authenticated",
  );
}
