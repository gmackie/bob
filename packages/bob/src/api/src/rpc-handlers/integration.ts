import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  integrationDelete,
  integrationFetchLinearTeams,
  integrationGet,
  integrationList,
  integrationSave,
  integrationSetupLinear,
} from "../handlers/integration.js";

export const makeIntegrationRpcHandlers = (ctx: HandlerContext) => ({
  "integration.list": ({
    payload,
  }: {
    payload: { workspaceId: string };
  }) => wrapHandler(integrationList, ctx, payload, "integration"),

  "integration.get": ({
    payload,
  }: {
    payload: { workspaceId: string; provider: string };
  }) => wrapHandler(integrationGet, ctx, payload, "integration"),

  "integration.save": ({
    payload,
  }: {
    payload: {
      workspaceId: string;
      provider: string;
      apiKey?: string;
      webhookSigningSecret?: string;
      linearTeamId?: string;
      linearWebBaseUrl?: string | null;
      enabled?: boolean;
    };
  }) => wrapHandler(integrationSave, ctx, payload, "integration"),

  "integration.fetchLinearTeams": ({
    payload,
  }: {
    payload: { apiKey: string };
  }) => wrapHandler(integrationFetchLinearTeams, ctx, payload, "integration"),

  "integration.setupLinear": ({
    payload,
  }: {
    payload: {
      workspaceId: string;
      apiKey: string;
      teamId: string;
      webhookUrl: string;
      linearWebBaseUrl?: string | null;
    };
  }) => wrapHandler(integrationSetupLinear, ctx, payload, "integration"),

  "integration.delete": ({
    payload,
  }: {
    payload: { workspaceId: string; provider: string };
  }) => wrapHandler(integrationDelete, ctx, payload, "integration"),
});
