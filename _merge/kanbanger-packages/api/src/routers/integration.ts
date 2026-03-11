import { z } from "zod";
import crypto from "crypto";
import { eq, and, desc } from "drizzle-orm";

const PROJECT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e",
];

function getRandomColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]!;
}
import {
  integrations,
  integrationRepos,
  webhooks,
  webhookDeliveries,
  issueGitLinks,
  issues,
  activities,
  teams,
  projects,
  projectRepositories,
  users,
  forgeRepositories,
} from "@linear-clone/db";
import { router, protectedProcedure, publicProcedure } from "../trpc";

const integrationTypeEnum = z.enum([
  "github",
  "gitea",
  "gitlab",
  "slack",
  "discord",
  "bob",
]);

export const bobLaunchPolicySchema = z.enum(["auto_or_manual", "manual_only"]);

export const bobIntegrationSettingsSchema = z.object({
  baseUrl: z.string().url(),
  sharedSecret: z.string().min(1),
  launchPolicy: bobLaunchPolicySchema,
  defaultAwaitingInputTimeoutMinutes: z.number().int().min(1).max(1440),
  commentMirroring: z.enum(["milestones_only"]),
});

export const bobIntegrationSettingsUpdateSchema =
  bobIntegrationSettingsSchema.partial();

interface RepoInput {
  provider: "github" | "gitea";
  fullName: string;
}

interface UserWithTokens {
  githubAccessToken: string | null;
  giteaAccessToken: string | null;
}

async function setupWebhookForProvider(
  ctx: { db: typeof import("@linear-clone/db").db },
  workspaceId: string,
  repo: RepoInput,
  user: UserWithTokens
): Promise<void> {
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/${repo.provider}`;
  const secret = crypto.randomBytes(32).toString("hex");
  const events = ["push", "pull_request"];

  if (repo.provider === "github") {
    if (!user.githubAccessToken) throw new Error("GitHub not connected");

    const response = await fetch(`https://api.github.com/repos/${repo.fullName}/hooks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.githubAccessToken}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events,
        config: { url: webhookUrl, content_type: "json", secret, insecure_ssl: "0" },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub webhook failed: ${error}`);
    }

    await ctx.db.insert(webhooks).values({
      workspaceId,
      provider: "github",
      repositoryUrl: repo.fullName,
      url: webhookUrl,
      secret,
      events,
      enabled: true,
    });
  } else if (repo.provider === "gitea") {
    if (!user.giteaAccessToken) throw new Error("Gitea not connected");

    const giteaUrl = process.env.GITEA_URL || "https://git.gmac.io";

    const response = await fetch(`${giteaUrl}/api/v1/repos/${repo.fullName}/hooks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.giteaAccessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "gitea",
        active: true,
        events,
        config: { url: webhookUrl, content_type: "json", secret },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gitea webhook failed: ${error}`);
    }

    await ctx.db.insert(webhooks).values({
      workspaceId,
      provider: "gitea",
      repositoryUrl: repo.fullName,
      url: webhookUrl,
      secret,
      events,
      enabled: true,
    });
  }
}

export const createIntegrationInputSchema = z
  .object({
  workspaceId: z.string().uuid(),
  type: integrationTypeEnum,
  name: z.string().min(1).max(100),
  settings: z.record(z.unknown()).optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.type !== "bob") {
      return;
    }

    const result = bobIntegrationSettingsSchema.safeParse(input.settings);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["settings", ...issue.path],
        });
      }
    }
  });

export const updateIntegrationInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  settings: z
    .union([z.record(z.unknown()), bobIntegrationSettingsUpdateSchema])
    .optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  enabled: z.boolean().optional(),
});

const createRepoInput = z.object({
  integrationId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  externalId: z.string(),
  name: z.string(),
  fullName: z.string(),
  url: z.string().url().optional(),
  defaultBranch: z.string().default("main"),
  autoLinkEnabled: z.boolean().default(true),
  autoCloseEnabled: z.boolean().default(true),
});

export const integrationRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select()
        .from(integrations)
        .where(eq(integrations.workspaceId, input.workspaceId))
        .orderBy(integrations.name);

      return result;
    }),

  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [integration] = await ctx.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, input.id))
      .limit(1);

    if (!integration) return null;

    const repos = await ctx.db
      .select({
        repo: integrationRepos,
        project: {
          id: projects.id,
          name: projects.name,
          key: projects.key,
          color: projects.color,
        },
        team: {
          id: teams.id,
          name: teams.name,
          key: teams.key,
        },
      })
      .from(integrationRepos)
      .leftJoin(projects, eq(integrationRepos.projectId, projects.id))
      .leftJoin(teams, eq(integrationRepos.teamId, teams.id))
      .where(eq(integrationRepos.integrationId, input.id));

    return {
      ...integration,
      repos: repos.map((r) => ({ ...r.repo, project: r.project, team: r.team })),
    };
  }),

  create: protectedProcedure.input(createIntegrationInputSchema).mutation(async ({ ctx, input }) => {
    const [integration] = await ctx.db.insert(integrations).values(input).returning();

    return integration;
  }),

  update: protectedProcedure.input(updateIntegrationInputSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const [integration] = await ctx.db
      .update(integrations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(integrations.id, id))
      .returning();

    return integration;
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(integrations).where(eq(integrations.id, input.id));
    return { success: true };
  }),

  addRepo: protectedProcedure.input(createRepoInput).mutation(async ({ ctx, input }) => {
    const [repo] = await ctx.db.insert(integrationRepos).values(input).returning();

    return repo;
  }),

  updateRepo: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        projectId: z.string().uuid().nullish(),
        teamId: z.string().uuid().nullish(),
        autoLinkEnabled: z.boolean().optional(),
        autoCloseEnabled: z.boolean().optional(),
        defaultBranch: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const [repo] = await ctx.db
        .update(integrationRepos)
        .set(data)
        .where(eq(integrationRepos.id, id))
        .returning();

      return repo;
    }),

  removeRepo: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(integrationRepos).where(eq(integrationRepos.id, input.id));
    return { success: true };
  }),

  getIssueGitLinks: protectedProcedure.input(z.object({ issueId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const result = await ctx.db
      .select({
        link: issueGitLinks,
        repo: {
          id: integrationRepos.id,
          name: integrationRepos.name,
          fullName: integrationRepos.fullName,
          url: integrationRepos.url,
        },
      })
      .from(issueGitLinks)
      .leftJoin(integrationRepos, eq(issueGitLinks.integrationRepoId, integrationRepos.id))
      .where(eq(issueGitLinks.issueId, input.issueId))
      .orderBy(desc(issueGitLinks.createdAt));

    return result.map((r) => ({ ...r.link, repo: r.repo }));
  }),

  linkToIssue: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        integrationRepoId: z.string().uuid().optional(),
        provider: z.enum(["github", "gitea", "gitlab"]).default("github"),
        type: z.enum(["pull_request", "commit", "branch"]),
        externalId: z.string(),
        number: z.number().optional(),
        title: z.string().optional(),
        url: z.string().url(),
        state: z.enum(["open", "closed", "merged"]).optional(),
        author: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db
        .insert(issueGitLinks)
        .values({
          ...input,
          provider: input.provider,
        })
        .onConflictDoUpdate({
          target: [issueGitLinks.url],
          set: {
            state: input.state,
            title: input.title,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!link) {
        throw new Error("Failed to create git link");
      }

      await ctx.db.insert(activities).values({
        issueId: input.issueId,
        type: input.type === "pull_request" ? "linked_to_pr" : "linked_to_commit",
        metadata: { linkId: link.id, type: input.type, url: input.url },
      });

      return link;
    }),

  processGitHubWebhook: publicProcedure
    .input(
      z.object({
        event: z.string(),
        payload: z.record(z.unknown()),
        signature: z.string().optional(),
        webhookId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { event, payload } = input;

      if (input.webhookId) {
        await ctx.db.insert(webhookDeliveries).values({
          webhookId: input.webhookId,
          event,
          payload: payload,
          success: true,
          statusCode: 200,
        });
      }

      const issueIdentifierRegex = /([A-Z]{2,10}-\d+)/g;

      if (event === "pull_request") {
        const pr = payload as {
          action: string;
          pull_request: {
            id: number;
            number: number;
            title: string;
            html_url: string;
            state: string;
            merged: boolean;
            user: { login: string };
            head: { ref: string };
          };
          repository: {
            id: number;
            full_name: string;
          };
        };

        const titleMatches = pr.pull_request.title.match(issueIdentifierRegex) ?? [];
        const branchMatches = pr.pull_request.head.ref.match(issueIdentifierRegex) ?? [];
        const identifiers = [...new Set([...titleMatches, ...branchMatches])];

        const [repoByExternalId] = await ctx.db
          .select({
            repo: integrationRepos,
            project: {
              id: projects.id,
              key: projects.key,
            },
          })
          .from(integrationRepos)
          .leftJoin(projects, eq(integrationRepos.projectId, projects.id))
          .where(eq(integrationRepos.externalId, String(pr.repository.id)))
          .limit(1);

        const [projectByRepoId] = await ctx.db
          .select()
          .from(projects)
          .where(eq(projects.repositoryExternalId, String(pr.repository.id)))
          .limit(1);

        const [projectByProjectRepos] = await ctx.db
          .select({ project: projects })
          .from(projectRepositories)
          .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
          .where(eq(projectRepositories.externalId, String(pr.repository.id)))
          .limit(1);

        const repo = repoByExternalId?.repo;
        const linkedProject = repoByExternalId?.project ?? projectByRepoId ?? projectByProjectRepos?.project;

        const linkedIssues: string[] = [];

        for (const identifier of identifiers) {
          const conditions = [eq(issues.identifier, identifier)];

          if (linkedProject) {
            conditions.push(eq(issues.projectId, linkedProject.id) as ReturnType<typeof eq>);
          }

          const [issue] = await ctx.db
            .select()
            .from(issues)
            .where(linkedProject ? and(...conditions) : eq(issues.identifier, identifier))
            .limit(1);

          if (issue) {
            linkedIssues.push(issue.identifier);

            let state: "open" | "closed" | "merged" = "open";
            if (pr.pull_request.merged) {
              state = "merged";
            } else if (pr.pull_request.state === "closed") {
              state = "closed";
            }

            await ctx.db
              .insert(issueGitLinks)
              .values({
                issueId: issue.id,
                integrationRepoId: repo?.id,
                provider: "github",
                type: "pull_request",
                externalId: String(pr.pull_request.id),
                number: pr.pull_request.number,
                title: pr.pull_request.title,
                url: pr.pull_request.html_url,
                state,
                author: pr.pull_request.user.login,
              })
              .onConflictDoUpdate({
                target: [issueGitLinks.url],
                set: {
                  state,
                  title: pr.pull_request.title,
                  updatedAt: new Date(),
                },
              });

            const shouldAutoClose = repo?.autoCloseEnabled ?? true;

            if (shouldAutoClose) {
              if (state === "merged" && issue.status !== "done") {
                await ctx.db
                  .update(issues)
                  .set({
                    status: "done",
                    completedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(eq(issues.id, issue.id));

                await ctx.db.insert(activities).values({
                  issueId: issue.id,
                  type: "status_changed",
                  fromValue: issue.status,
                  toValue: "done",
                  metadata: {
                    reason: "pr_merged",
                    prUrl: pr.pull_request.html_url,
                    prNumber: pr.pull_request.number,
                  },
                });
              } else if (
                (pr.action === "opened" || pr.action === "reopened") &&
                !["done", "in_review", "canceled"].includes(issue.status)
              ) {
                await ctx.db
                  .update(issues)
                  .set({
                    status: "in_review",
                    updatedAt: new Date(),
                  })
                  .where(eq(issues.id, issue.id));

                await ctx.db.insert(activities).values({
                  issueId: issue.id,
                  type: "status_changed",
                  fromValue: issue.status,
                  toValue: "in_review",
                  metadata: {
                    reason: "pr_opened",
                    prUrl: pr.pull_request.html_url,
                    prNumber: pr.pull_request.number,
                  },
                });
              }
            }
          }
        }

        return { success: true, event: "pull_request", identifiers, linkedIssues };
      }

      if (event === "push") {
        const push = payload as {
          commits: Array<{
            id: string;
            message: string;
            url: string;
            author: { name: string; username?: string };
            timestamp: string;
          }>;
          repository: {
            id: number;
            full_name: string;
          };
          ref: string;
        };

        const [repoByExternalId] = await ctx.db
          .select({
            repo: integrationRepos,
            project: { id: projects.id, key: projects.key },
          })
          .from(integrationRepos)
          .leftJoin(projects, eq(integrationRepos.projectId, projects.id))
          .where(eq(integrationRepos.externalId, String(push.repository.id)))
          .limit(1);

        const [projectByRepoId] = await ctx.db
          .select()
          .from(projects)
          .where(eq(projects.repositoryExternalId, String(push.repository.id)))
          .limit(1);

        const [projectByProjectRepos] = await ctx.db
          .select({ project: projects })
          .from(projectRepositories)
          .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
          .where(eq(projectRepositories.externalId, String(push.repository.id)))
          .limit(1);

        const repo = repoByExternalId?.repo;
        const linkedProject = repoByExternalId?.project ?? projectByRepoId ?? projectByProjectRepos?.project;

        const linkedIssues: string[] = [];

        for (const commit of push.commits ?? []) {
          const matches = commit.message.match(issueIdentifierRegex) ?? [];

          for (const identifier of matches) {
            const [issue] = await ctx.db
              .select()
              .from(issues)
              .where(
                linkedProject
                  ? and(eq(issues.identifier, identifier), eq(issues.projectId, linkedProject.id))
                  : eq(issues.identifier, identifier)
              )
              .limit(1);

            if (issue) {
              linkedIssues.push(issue.identifier);

              await ctx.db
                .insert(issueGitLinks)
                .values({
                  issueId: issue.id,
                  integrationRepoId: repo?.id,
                  provider: "github",
                  type: "commit",
                  externalId: commit.id,
                  title: commit.message.split("\n")[0]?.substring(0, 100),
                  url: commit.url,
                  author: commit.author.username ?? commit.author.name,
                  state: "merged",
                })
                .onConflictDoNothing();
            }
          }
        }

        return { success: true, event: "push", linkedIssues };
      }

      if (event === "deployment" || event === "deployment_status") {
        const deployment = payload as {
          deployment?: {
            id: number;
            ref: string;
            sha: string;
            environment: string;
            description: string;
          };
          deployment_status?: {
            state: string;
            environment: string;
            description: string;
            target_url: string;
          };
          repository: {
            id: number;
            full_name: string;
          };
        };

        const [projectByRepoId] = await ctx.db
          .select()
          .from(projects)
          .where(eq(projects.repositoryExternalId, String(deployment.repository.id)))
          .limit(1);

        return {
          success: true,
          event,
          projectId: projectByRepoId?.id,
          environment: deployment.deployment_status?.environment ?? deployment.deployment?.environment,
          state: deployment.deployment_status?.state,
        };
      }

      return { success: true, event, handled: false };
    }),

  processGiteaWebhook: publicProcedure
    .input(
      z.object({
        event: z.string(),
        payload: z.record(z.unknown()),
        signature: z.string().optional(),
        webhookId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { event, payload } = input;

      const issueIdentifierRegex = /([A-Z]{2,10}-\d+)/g;

      if (event === "pull_request") {
        const pr = payload as {
          action: string;
          pull_request: {
            id: number;
            number: number;
            title: string;
            html_url: string;
            state: string;
            merged: boolean;
            user: { login: string };
            head: { ref: string };
          };
          repository: {
            id: number;
            full_name: string;
          };
        };

        const titleMatches = pr.pull_request.title.match(issueIdentifierRegex) ?? [];
        const branchMatches = pr.pull_request.head.ref.match(issueIdentifierRegex) ?? [];
        const identifiers = [...new Set([...titleMatches, ...branchMatches])];

        const [projectByRepoId] = await ctx.db
          .select()
          .from(projects)
          .where(eq(projects.repositoryExternalId, String(pr.repository.id)))
          .limit(1);

        const [projectByProjectRepos] = await ctx.db
          .select({ project: projects })
          .from(projectRepositories)
          .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
          .where(eq(projectRepositories.externalId, String(pr.repository.id)))
          .limit(1);

        const linkedProject = projectByRepoId ?? projectByProjectRepos?.project;
        const linkedIssues: string[] = [];

        for (const identifier of identifiers) {
          const [issue] = await ctx.db
            .select()
            .from(issues)
            .where(
              linkedProject
                ? and(eq(issues.identifier, identifier), eq(issues.projectId, linkedProject.id))
                : eq(issues.identifier, identifier)
            )
            .limit(1);

          if (issue) {
            linkedIssues.push(issue.identifier);

            let state: "open" | "closed" | "merged" = "open";
            if (pr.pull_request.merged) {
              state = "merged";
            } else if (pr.pull_request.state === "closed") {
              state = "closed";
            }

            await ctx.db
              .insert(issueGitLinks)
              .values({
                issueId: issue.id,
                provider: "gitea",
                type: "pull_request",
                externalId: String(pr.pull_request.id),
                number: pr.pull_request.number,
                title: pr.pull_request.title,
                url: pr.pull_request.html_url,
                state,
                author: pr.pull_request.user.login,
              })
              .onConflictDoUpdate({
                target: [issueGitLinks.url],
                set: {
                  state,
                  title: pr.pull_request.title,
                  updatedAt: new Date(),
                },
              });

            if (state === "merged" && issue.status !== "done") {
              await ctx.db
                .update(issues)
                .set({
                  status: "done",
                  completedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(issues.id, issue.id));

              await ctx.db.insert(activities).values({
                issueId: issue.id,
                type: "status_changed",
                fromValue: issue.status,
                toValue: "done",
                metadata: { reason: "pr_merged", prUrl: pr.pull_request.html_url },
              });
            }
          }
        }

        return { success: true, event: "pull_request", identifiers, linkedIssues };
      }

      if (event === "push") {
        const push = payload as {
          commits: Array<{
            id: string;
            message: string;
            url: string;
            author: { name: string; username?: string };
          }>;
          repository: {
            id: number;
            full_name: string;
          };
        };

        const [projectByRepoId] = await ctx.db
          .select()
          .from(projects)
          .where(eq(projects.repositoryExternalId, String(push.repository.id)))
          .limit(1);

        const [projectByProjectRepos] = await ctx.db
          .select({ project: projects })
          .from(projectRepositories)
          .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
          .where(eq(projectRepositories.externalId, String(push.repository.id)))
          .limit(1);

        const linkedProject = projectByRepoId ?? projectByProjectRepos?.project;
        const linkedIssues: string[] = [];

        for (const commit of push.commits ?? []) {
          const matches = commit.message.match(issueIdentifierRegex) ?? [];

          for (const identifier of matches) {
            const [issue] = await ctx.db
              .select()
              .from(issues)
              .where(
                linkedProject
                  ? and(eq(issues.identifier, identifier), eq(issues.projectId, linkedProject.id))
                  : eq(issues.identifier, identifier)
              )
              .limit(1);

            if (issue) {
              linkedIssues.push(issue.identifier);

              await ctx.db
                .insert(issueGitLinks)
                .values({
                  issueId: issue.id,
                  provider: "gitea",
                  type: "commit",
                  externalId: commit.id,
                  title: commit.message.split("\n")[0]?.substring(0, 100),
                  url: commit.url,
                  author: commit.author.username ?? commit.author.name,
                })
                .onConflictDoNothing();
            }
          }
        }

        return { success: true, event: "push", linkedIssues };
      }

      return { success: true, event, handled: false };
    }),

  getWebhookDeliveries: protectedProcedure
    .input(
      z.object({
        webhookId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, input.webhookId))
        .orderBy(desc(webhookDeliveries.deliveredAt))
        .limit(input.limit);

      return result;
    }),

  listWebhooks: protectedProcedure.input(z.object({ workspaceId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const result = await ctx.db.select().from(webhooks).where(eq(webhooks.workspaceId, input.workspaceId));

    return result;
  }),

  deleteWebhook: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(webhooks).where(eq(webhooks.id, input.id));
      return { success: true };
    }),

  toggleWebhook: protectedProcedure
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [webhook] = await ctx.db
        .update(webhooks)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(webhooks.id, input.id))
        .returning();
      return webhook;
    }),

  createWebhook: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        integrationId: z.string().uuid().optional(),
        provider: z.enum(["github", "gitea", "gitlab"]).default("github"),
        repositoryUrl: z.string().optional(),
        url: z.string().url(),
        secret: z.string().optional(),
        events: z.array(z.string()).default([]),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [webhook] = await ctx.db.insert(webhooks).values(input).returning();

      return webhook;
    }),

  getGitHubRepos: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    if (!user?.githubAccessToken) {
      return { connected: false, repos: [] };
    }

    try {
      const allRepos: Array<{
        id: number;
        name: string;
        full_name: string;
        html_url: string;
        description: string | null;
        private: boolean;
        default_branch: string;
        owner: { login: string; avatar_url: string };
        updated_at: string;
      }> = [];

      let page = 1;
      const perPage = 100;
      let hasMore = true;

      while (hasMore) {
        const response = await fetch(
          `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=updated`,
          {
            headers: {
              Authorization: `Bearer ${user.githubAccessToken}`,
              Accept: "application/vnd.github+json",
            },
          }
        );

        if (!response.ok) {
          if (response.status === 401) {
            return { connected: false, repos: [], error: "Token expired" };
          }
          throw new Error("Failed to fetch GitHub repos");
        }

        const repos = await response.json() as typeof allRepos;
        allRepos.push(...repos);

        if (repos.length < perPage || page >= 10) {
          hasMore = false;
        } else {
          page++;
        }
      }

      return {
        connected: true,
        username: user.githubUsername,
        repos: allRepos.map((r) => ({
          id: String(r.id),
          name: r.name,
          fullName: r.full_name,
          url: r.html_url,
          description: r.description,
          private: r.private,
          defaultBranch: r.default_branch,
          owner: r.owner.login,
          ownerAvatar: r.owner.avatar_url,
          updatedAt: r.updated_at,
        })),
      };
    } catch (error) {
      console.error("GitHub repos error:", error);
      return { connected: true, repos: [], error: "Failed to fetch repos" };
    }
  }),

  getGiteaRepos: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    if (!user?.giteaAccessToken) {
      return { connected: false, repos: [] };
    }

    const giteaUrl = process.env.GITEA_URL || "https://git.gmac.io";

    try {
      const allRepos: Array<{
        id: number;
        name: string;
        full_name: string;
        html_url: string;
        description: string;
        private: boolean;
        default_branch: string;
        owner: { login: string; avatar_url: string };
        updated_at: string;
      }> = [];

      let page = 1;
      const limit = 50;
      let hasMore = true;

      while (hasMore) {
        const response = await fetch(
          `${giteaUrl}/api/v1/user/repos?limit=${limit}&page=${page}`,
          {
            headers: {
              Authorization: `Bearer ${user.giteaAccessToken}`,
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          if (response.status === 401) {
            return { connected: false, repos: [], error: "Token expired" };
          }
          throw new Error("Failed to fetch Gitea repos");
        }

        const repos = await response.json() as typeof allRepos;
        allRepos.push(...repos);

        if (repos.length < limit || page >= 20) {
          hasMore = false;
        } else {
          page++;
        }
      }

      return {
        connected: true,
        username: user.giteaUsername,
        repos: allRepos.map((r) => ({
          id: String(r.id),
          name: r.name,
          fullName: r.full_name,
          url: r.html_url,
          description: r.description,
          private: r.private,
          defaultBranch: r.default_branch,
          owner: r.owner.login,
          ownerAvatar: r.owner.avatar_url,
          updatedAt: r.updated_at,
        })),
      };
    } catch (error) {
      console.error("Gitea repos error:", error);
      return { connected: true, repos: [], error: "Failed to fetch repos" };
    }
  }),

  createProjectFromRepo: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        provider: z.enum(["github", "gitea"]),
        repoId: z.string(),
        repoName: z.string(),
        repoFullName: z.string(),
        repoUrl: z.string().url(),
        defaultBranch: z.string().default("main"),
        projectName: z.string().min(1).max(100).optional(),
        projectKey: z.string().min(2).max(10).regex(/^[A-Z][A-Z0-9]*$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const name = input.projectName || input.repoName;
      const baseKey = input.projectKey || name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

      const existing = await ctx.db
        .select({ key: projects.key })
        .from(projects)
        .where(eq(projects.workspaceId, input.workspaceId));

      const existingKeys = new Set(existing.map((p) => p.key));
      let key = baseKey;
      let counter = 2;
      while (existingKeys.has(key)) {
        key = `${baseKey}${counter}`;
        counter++;
      }

      const [project] = await ctx.db
        .insert(projects)
        .values({
          workspaceId: input.workspaceId,
          name,
          key,
          color: getRandomColor(),
          repositoryProvider: input.provider,
          repositoryFullName: input.repoFullName,
          repositoryUrl: input.repoUrl,
          repositoryExternalId: input.repoId,
        })
        .returning();

      return project;
    }),

  setupWebhookForRepo: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        provider: z.enum(["github", "gitea"]),
        repoFullName: z.string(),
        events: z.array(z.string()).default(["push", "pull_request"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/${input.provider}`;
      const secret = crypto.randomBytes(32).toString("hex");

      if (input.provider === "github") {
        if (!user?.githubAccessToken) {
          throw new Error("GitHub not connected");
        }

        const response = await fetch(
          `https://api.github.com/repos/${input.repoFullName}/hooks`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${user.githubAccessToken}`,
              Accept: "application/vnd.github+json",
            },
            body: JSON.stringify({
              name: "web",
              active: true,
              events: input.events,
              config: {
                url: webhookUrl,
                content_type: "json",
                secret,
                insecure_ssl: "0",
              },
            }),
          }
        );

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Failed to create GitHub webhook: ${error}`);
        }

        const hook = await response.json() as { id: number };

        const [webhook] = await ctx.db
          .insert(webhooks)
          .values({
            workspaceId: input.workspaceId,
            provider: "github",
            repositoryUrl: input.repoFullName,
            url: webhookUrl,
            secret,
            events: input.events,
            enabled: true,
          })
          .returning();

        return { webhook, externalId: hook.id };
      }

      if (input.provider === "gitea") {
        if (!user?.giteaAccessToken) {
          throw new Error("Gitea not connected");
        }

        const giteaUrl = process.env.GITEA_URL || "https://git.gmac.io";

        const response = await fetch(
          `${giteaUrl}/api/v1/repos/${input.repoFullName}/hooks`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${user.giteaAccessToken}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "gitea",
              active: true,
              events: input.events,
              config: {
                url: webhookUrl,
                content_type: "json",
                secret,
              },
            }),
          }
        );

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Failed to create Gitea webhook: ${error}`);
        }

        const hook = await response.json() as { id: number };

        const [webhook] = await ctx.db
          .insert(webhooks)
          .values({
            workspaceId: input.workspaceId,
            provider: "gitea",
            repositoryUrl: input.repoFullName,
            url: webhookUrl,
            secret,
            events: input.events,
            enabled: true,
          })
          .returning();

        return { webhook, externalId: hook.id };
      }

      throw new Error("Unsupported provider");
    }),

  disconnectGitHub: protectedProcedure.mutation(async ({ ctx }) => {
    const user = ctx.user;
    if (!user) throw new Error("Not authenticated");

    await ctx.db
      .update(users)
      .set({
        githubId: null,
        githubUsername: null,
        githubAccessToken: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { success: true };
  }),

  disconnectGitea: protectedProcedure.mutation(async ({ ctx }) => {
    const user = ctx.user;
    if (!user) throw new Error("Not authenticated");

    await ctx.db
      .update(users)
      .set({
        giteaId: null,
        giteaUsername: null,
        giteaAccessToken: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { success: true };
  }),

  bulkImportRepos: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        repos: z.array(
          z.object({
            provider: z.enum(["github", "gitea"]),
            id: z.string(),
            name: z.string(),
            fullName: z.string(),
            url: z.string().url(),
            defaultBranch: z.string().default("main"),
          })
        ),
        setupWebhooks: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) throw new Error("Not authenticated");

      const reposByName = new Map<string, typeof input.repos>();
      for (const repo of input.repos) {
        const normalizedName = repo.name.toLowerCase();
        const existing = reposByName.get(normalizedName) ?? [];
        existing.push(repo);
        reposByName.set(normalizedName, existing);
      }

      const existingProjects = await ctx.db
        .select({ key: projects.key })
        .from(projects)
        .where(eq(projects.workspaceId, input.workspaceId));
      const existingKeys = new Set(existingProjects.map((p) => p.key));

      const createdProjects: Array<{
        id: string;
        name: string;
        key: string;
        repos: Array<{ provider: string; fullName: string }>;
      }> = [];

      for (const [name, repos] of reposByName) {
        const primaryRepo = repos[0]!;
        const baseKey = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "PROJ";
        let key = baseKey;
        let counter = 2;
        while (existingKeys.has(key)) {
          key = `${baseKey}${counter}`;
          counter++;
        }
        existingKeys.add(key);

        const [project] = await ctx.db
          .insert(projects)
          .values({
            workspaceId: input.workspaceId,
            name: primaryRepo.name,
            key,
            color: getRandomColor(),
            repositoryProvider: primaryRepo.provider,
            repositoryFullName: primaryRepo.fullName,
            repositoryUrl: primaryRepo.url,
            repositoryExternalId: primaryRepo.id,
          })
          .returning();

        if (!project) continue;

        for (const repo of repos) {
          await ctx.db.insert(projectRepositories).values({
            projectId: project.id,
            provider: repo.provider,
            externalId: repo.id,
            fullName: repo.fullName,
            url: repo.url,
            defaultBranch: repo.defaultBranch,
            webhookConfigured: false,
          });
        }

        if (input.setupWebhooks) {
          for (const repo of repos) {
            try {
              await setupWebhookForProvider(ctx, input.workspaceId, repo, user);
              await ctx.db
                .update(projectRepositories)
                .set({ webhookConfigured: true })
                .where(
                  and(
                    eq(projectRepositories.projectId, project.id),
                    eq(projectRepositories.externalId, repo.id)
                  )
                );
            } catch (err) {
              console.error(`Webhook setup failed for ${repo.fullName}:`, err);
            }
          }
        }

        createdProjects.push({
          id: project.id,
          name: project.name,
          key: project.key,
          repos: repos.map((r) => ({ provider: r.provider, fullName: r.fullName })),
        });
      }

      return { created: createdProjects };
    }),

  getProjectRepositories: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const repos = await ctx.db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, input.projectId));
      return repos;
    }),

  addProjectRepository: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        provider: z.enum(["github", "gitea"]),
        externalId: z.string(),
        fullName: z.string(),
        url: z.string().url(),
        defaultBranch: z.string().default("main"),
        setupWebhook: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) throw new Error("Not authenticated");

      const [project] = await ctx.db
        .select({
          id: projects.id,
          workspaceId: projects.workspaceId,
          forgeRepositoryId: projects.forgeRepositoryId,
          repositoryProvider: projects.repositoryProvider,
        })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);

      if (!project) {
        throw new Error("Project not found");
      }

      const [forgeRepo] = project.forgeRepositoryId
        ? [null]
        : await ctx.db
            .insert(forgeRepositories)
            .values({
              workspaceId: project.workspaceId,
              name: project.id,
              storageBackend: "s3",
              storagePrefix: `${project.workspaceId}/${project.id}`,
            })
            .returning();

      const [repo] = await ctx.db
        .insert(projectRepositories)
        .values({
          projectId: input.projectId,
          provider: input.provider,
          externalId: input.externalId,
          fullName: input.fullName,
          url: input.url,
          defaultBranch: input.defaultBranch,
          webhookConfigured: false,
        })
        .returning();

      if (!repo) throw new Error("Failed to add repository");

      if (!project.repositoryProvider) {
        await ctx.db
          .update(projects)
          .set({
            repositoryProvider: input.provider,
            repositoryFullName: input.fullName,
            repositoryUrl: input.url,
            repositoryExternalId: input.externalId,
            updatedAt: new Date(),
            ...(forgeRepo ? { forgeRepositoryId: forgeRepo.id } : {}),
          })
          .where(eq(projects.id, input.projectId));
      } else if (forgeRepo) {
        await ctx.db
          .update(projects)
          .set({ forgeRepositoryId: forgeRepo.id, updatedAt: new Date() })
          .where(eq(projects.id, input.projectId));
      }

      if (input.setupWebhook) {
        try {
          await setupWebhookForProvider(
            ctx,
            project.workspaceId,
            { provider: input.provider, fullName: input.fullName },
            user
          );
          await ctx.db
            .update(projectRepositories)
            .set({ webhookConfigured: true })
            .where(eq(projectRepositories.id, repo.id));
          repo.webhookConfigured = true;
        } catch (err) {
          console.error(`Webhook setup failed for ${input.fullName}:`, err);
        }
      }

      return repo;
    }),

  removeProjectRepository: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(projectRepositories)
        .where(eq(projectRepositories.id, input.id));
      return { success: true };
    }),

  setupProjectRepoWebhook: protectedProcedure
    .input(
      z.object({
        repoId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) throw new Error("Not authenticated");

      const [repo] = await ctx.db
        .select({
          repo: projectRepositories,
          workspaceId: projects.workspaceId,
        })
        .from(projectRepositories)
        .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
        .where(eq(projectRepositories.id, input.repoId))
        .limit(1);

      if (!repo) throw new Error("Repository not found");

      await setupWebhookForProvider(
        ctx,
        repo.workspaceId,
        {
          provider: repo.repo.provider as "github" | "gitea",
          fullName: repo.repo.fullName,
        },
        user
      );

      await ctx.db
        .update(projectRepositories)
        .set({ webhookConfigured: true })
        .where(eq(projectRepositories.id, input.repoId));

      return { success: true };
    }),
});
