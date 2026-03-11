import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  workspaces,
  workspaceMembers,
  teams,
  teamMembers,
  projects,
  issues,
} from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

export const mobileRouter = router({
  bootstrap: protectedProcedure
    .input(
      z.object({
        includeIssues: z.boolean().default(true),
        issueLimit: z.number().min(1).max(100).default(50),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        return {
          user: null,
          workspaces: [],
          teams: [],
          projects: [],
          issues: [],
        };
      }

      const opts = input ?? { includeIssues: true, issueLimit: 50 };

      const workspaceMemberships = await ctx.db
        .select({
          workspace: workspaces,
          role: workspaceMembers.role,
          joinedAt: workspaceMembers.joinedAt,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(eq(workspaceMembers.userId, user.id))
        .orderBy(desc(workspaces.createdAt));

      if (workspaceMemberships.length === 0) {
        return {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            avatarUrl: user.avatarUrl,
          },
          workspaces: [],
          teams: [],
          projects: [],
          issues: [],
        };
      }

      const firstWorkspace = workspaceMemberships[0]!.workspace;

      const [teamsResult, projectsResult] = await Promise.all([
        ctx.db
          .select({
            team: teams,
            role: teamMembers.role,
          })
          .from(teams)
          .leftJoin(
            teamMembers,
            and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, user.id))
          )
          .where(eq(teams.workspaceId, firstWorkspace.id))
          .orderBy(teams.name),

        ctx.db
          .select({
            id: projects.id,
            name: projects.name,
            key: projects.key,
            color: projects.color,
            icon: projects.icon,
          })
          .from(projects)
          .where(eq(projects.workspaceId, firstWorkspace.id))
          .orderBy(projects.name),
      ]);

      let issuesResult: Array<{
        id: string;
        identifier: string;
        title: string;
        status: string;
        priority: string;
        dueDate: Date | null;
        projectId: string;
        projectColor: string | null;
      }> = [];

      if (opts.includeIssues) {
        const projectIds = projectsResult.map((p) => p.id);
        if (projectIds.length > 0) {
          const rawIssues = await ctx.db
            .select({
              id: issues.id,
              identifier: issues.identifier,
              title: issues.title,
              status: issues.status,
              priority: issues.priority,
              dueDate: issues.dueDate,
              projectId: issues.projectId,
              projectColor: projects.color,
            })
            .from(issues)
            .innerJoin(projects, eq(issues.projectId, projects.id))
            .where(
              and(
                inArray(issues.projectId, projectIds),
                eq(issues.assigneeId, user.id),
                eq(issues.trashed, false)
              )
            )
            .orderBy(desc(issues.updatedAt))
            .limit(opts.issueLimit);

          issuesResult = rawIssues;
        }
      }

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
        },
        workspaces: workspaceMemberships.map((m) => ({
          workspace: m.workspace,
          role: m.role,
          joinedAt: m.joinedAt,
        })),
        teams: teamsResult.map((t) => ({
          id: t.team.id,
          name: t.team.name,
          key: t.team.key,
          color: t.team.color,
          role: t.role,
        })),
        projects: projectsResult,
        issues: issuesResult,
      };
    }),
});
