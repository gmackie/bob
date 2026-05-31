import type { TRPCRouterRecord } from "@trpc/server";

import { and, count, eq, isNull } from "@bob/db";
import {
  agentInstances,
  apiKeys,
  notifications,
  taskRuns,
  webhookConfigs,
  workItems,
  workspaces,
} from "@bob/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function getBugReportUrl(): string {
  return (
    process.env.BOB_BUG_REPORT_URL ??
    process.env.NEXT_PUBLIC_BOB_BUG_REPORT_URL ??
    "https://github.com/gmackie/bob/issues/new?labels=bug"
  );
}

function getSupportEmail(): string {
  return (
    process.env.BOB_SUPPORT_EMAIL ??
    process.env.NEXT_PUBLIC_BOB_SUPPORT_EMAIL ??
    "support@blder.bot"
  );
}

function getEmergencyReason(): string {
  return (
    process.env.BOB_EMERGENCY_DISABLE_REASON ??
    "Bob is temporarily disabled while the team resolves an operational issue."
  );
}

function getSupportModel() {
  const emergencyDisabled = readBooleanEnv("BOB_EMERGENCY_DISABLED");

  return {
    bugReportUrl: getBugReportUrl(),
    emergencyDisabled,
    emergencyReason: emergencyDisabled ? getEmergencyReason() : null,
    generatedAt: new Date().toISOString(),
    supportEmail: getSupportEmail(),
  };
}

export const supportRouter = {
  model: publicProcedure.query(() => getSupportModel()),

  telemetry: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [
      workspaceCount,
      workItemCount,
      activeTaskRunCount,
      failedTaskRunCount,
      activeAgentCount,
      unreadNotificationCount,
      activeWebhookCount,
      activeApiKeyCount,
    ] = await Promise.all([
      ctx.db
        .select({ count: count() })
        .from(workspaces)
        .where(eq(workspaces.ownerUserId, userId))
        .then(([row]) => row?.count ?? 0),
      ctx.db
        .select({ count: count() })
        .from(workItems)
        .where(eq(workItems.ownerUserId, userId))
        .then(([row]) => row?.count ?? 0),
      ctx.db
        .select({ count: count() })
        .from(taskRuns)
        .where(and(eq(taskRuns.userId, userId), eq(taskRuns.status, "running")))
        .then(([row]) => row?.count ?? 0),
      ctx.db
        .select({ count: count() })
        .from(taskRuns)
        .where(and(eq(taskRuns.userId, userId), eq(taskRuns.status, "failed")))
        .then(([row]) => row?.count ?? 0),
      ctx.db
        .select({ count: count() })
        .from(agentInstances)
        .where(
          and(
            eq(agentInstances.userId, userId),
            eq(agentInstances.status, "running"),
          ),
        )
        .then(([row]) => row?.count ?? 0),
      ctx.db
        .select({ count: count() })
        .from(notifications)
        .where(
          and(eq(notifications.userId, userId), eq(notifications.read, false)),
        )
        .then(([row]) => row?.count ?? 0),
      ctx.db
        .select({ count: count() })
        .from(webhookConfigs)
        .where(
          and(
            eq(webhookConfigs.userId, userId),
            eq(webhookConfigs.active, true),
          ),
        )
        .then(([row]) => row?.count ?? 0),
      ctx.db
        .select({ count: count() })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
        .then(([row]) => row?.count ?? 0),
    ]);

    return {
      ...getSupportModel(),
      metrics: {
        activeAgents: activeAgentCount,
        activeApiKeys: activeApiKeyCount,
        activeTaskRuns: activeTaskRunCount,
        activeWebhooks: activeWebhookCount,
        failedTaskRuns: failedTaskRunCount,
        unreadNotifications: unreadNotificationCount,
        workItems: workItemCount,
        workspaces: workspaceCount,
      },
    };
  }),
} satisfies TRPCRouterRecord;
