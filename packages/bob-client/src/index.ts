import createClient from "openapi-fetch";
import { makeAgentClient, type AgentClient } from "./agent.js";
import { makeAuthClient, type AuthClient } from "./auth.js";
import { makeExternalClient, type ExternalClient } from "./external.js";
import { makePlanningClient, type PlanningClient } from "./planning.js";
import { makeProjectsClient, type ProjectsClient } from "./projects.js";
import { makeSecretsClient, type SecretsClient } from "./secrets.js";
import { makeSettingsClient, type SettingsClient } from "./settings.js";
import { makeWorkItemsClient, type WorkItemsClient } from "./work-items.js";
import {
  makeRuntime,
  type ClientRuntimeOptions,
} from "./internal/runtime.js";

export type BobClientOptions = ClientRuntimeOptions;

export interface BobRpcClient {
  readonly workItems: WorkItemsClient;
  readonly planning: PlanningClient;
  readonly external: ExternalClient;
  readonly agent: AgentClient;
  readonly projects: ProjectsClient;
  readonly settings: SettingsClient;
  readonly secrets: SecretsClient;
  readonly auth: AuthClient;
}

export const createBobRpcClient = (opts: BobClientOptions): BobRpcClient => {
  const runtime = makeRuntime(opts);
  return {
    workItems: makeWorkItemsClient(runtime),
    planning: makePlanningClient(runtime),
    external: makeExternalClient(runtime),
    agent: makeAgentClient(runtime),
    projects: makeProjectsClient(runtime),
    settings: makeSettingsClient(runtime),
    secrets: makeSecretsClient(runtime),
    auth: makeAuthClient(runtime),
  };
};

// TODO: Once openapi-typescript generates schema.d.ts from dist/openapi/bob.json,
// import the paths type and pass it as the generic parameter:
//   import type { paths } from "../schema";
//   export function createBobClient(baseUrl = "https://bob.blder.bot") {
//     return createClient<paths>({ baseUrl });
//   }

/**
 * @deprecated Use {@link createBobRpcClient} for Bob app/mobile/CLI RPC calls.
 * This remains only for temporary REST/OpenAPI consumers.
 *
 * Create an HTTP client for the Bob API.
 *
 * Currently untyped — run `openapi-typescript dist/openapi/bob.json -o
 * packages/bob-client/schema.d.ts` and add the `paths` generic to get
 * full request/response types.
 */
export function createBobClient(baseUrl = "https://bob.blder.bot") {
  return createClient({ baseUrl });
}

export const __bobClientPhase = "effect-rpc-client" as const;
