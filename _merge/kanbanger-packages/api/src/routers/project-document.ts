import { z } from "zod";
import { eq, desc, asc, and } from "drizzle-orm";
import { issues, projectDocuments, projects } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

const documentTypeEnum = z.enum([
  "planning",
  "roadmap",
  "brd",
  "detailed_requirements",
  "spec",
  "design",
  "design_doc",
  "notes",
  "team_paradigm",
  "other",
]);

const agentDocCategoryEnum = z.enum([
  "brd",
  "detailed_requirements",
  "epics",
  "tasks",
  "design_docs",
  "team_paradigms",
]);
type AgentDocCategory = z.infer<typeof agentDocCategoryEnum>;

const funnelArtifactTypeOrder = [
  "idea",
  "plan",
  "brd",
  "spec",
  "task",
  "pr",
  "release",
] as const;
type FunnelArtifactType = (typeof funnelArtifactTypeOrder)[number];

const funnelStageOrder = [
  "dumped",
  "triaged",
  "planned",
  "designed",
  "ready_for_execution",
  "picked_up",
  "staging_deployed",
  "staging_verified",
  "production_deployed",
] as const;
type FunnelStage = (typeof funnelStageOrder)[number];

const funnelArtifactTypeRank: Record<FunnelArtifactType, number> = funnelArtifactTypeOrder.reduce(
  (acc, type, index) => {
    acc[type] = index;
    return acc;
  },
  {} as Record<FunnelArtifactType, number>
);

const funnelStageRank: Record<FunnelStage, number> = funnelStageOrder.reduce(
  (acc, stage, index) => {
    acc[stage] = index;
    return acc;
  },
  {} as Record<FunnelStage, number>
);

function getCategoryTerms(category: string): string[] {
  switch (category) {
    case "brd":
    case "detailed_requirements":
      return ["brd", "requirements", "requirements doc", "spec"];
    case "epics":
      return ["epic", "epics", "initiative", "milestone"];
    case "tasks":
      return ["task", "todo", "backlog", "story", "feature"];
    case "design_docs":
      return ["design", "architecture", "ui", "ux", "interface", "api"];
    case "team_paradigms":
      return ["team", "workflow", "process", "paradigm", "convention", "agreement"];
    default:
      return [];
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function getDocumentScore(
  text: string,
  terms: string[]
): number {
  return terms.filter((term) => text.includes(term)).length;
}

function getWordsFromTask(task?: {
  title: string | null;
  description: string | null;
} | null): string[] {
  if (!task) {
    return [];
  }

  const merged = `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase();
  return merged
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .slice(0, 8);
}

function isTaskRelevant(
  row: { title: string; description: string | null },
  terms: string[]
): boolean {
  if (terms.length === 0) {
    return true;
  }

  const haystack = normalizeText(`${row.title} ${row.description ?? ""}`);
  return terms.some((term) => haystack.includes(term));
}

function getFunnelOrdering(task: {
  funnelArtifactType: string | null;
  funnelStage: string | null;
} | null): {
  artifactType: FunnelArtifactType | null;
  artifactIndex: number;
  stageIndex: number;
} {
  if (!task?.funnelArtifactType || !task?.funnelStage) {
    return {
      artifactType: null,
      artifactIndex: -1,
      stageIndex: -1,
    };
  }

  const artifactType = task.funnelArtifactType as FunnelArtifactType;
  const artifactIndex = funnelArtifactTypeRank[artifactType];
  const stageIndex = funnelStageRank[task.funnelStage as FunnelStage];

  return {
    artifactType: artifactType ?? null,
    artifactIndex: Number.isInteger(artifactIndex) ? artifactIndex : -1,
    stageIndex: Number.isInteger(stageIndex) ? stageIndex : -1,
  };
}

const createDocumentInput = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(500),
  content: z.string(),
  type: documentTypeEnum.default("planning"),
});

const updateDocumentInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  content: z.string().optional(),
  type: documentTypeEnum.optional(),
  sortOrder: z.number().int().optional(),
});

export const projectDocumentRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const docs = await ctx.db
        .select()
        .from(projectDocuments)
        .where(eq(projectDocuments.projectId, input.projectId))
        .orderBy(asc(projectDocuments.sortOrder), desc(projectDocuments.createdAt));

      return docs;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select()
        .from(projectDocuments)
        .where(eq(projectDocuments.id, input.id))
        .limit(1);

      return doc ?? null;
    }),

  create: protectedProcedure
    .input(createDocumentInput)
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      const [doc] = await ctx.db
        .insert(projectDocuments)
        .values({
          projectId: input.projectId,
          title: input.title,
          content: input.content,
          type: input.type,
          createdById: user?.id,
          updatedById: user?.id,
        })
        .returning();

      return doc;
    }),

  update: protectedProcedure
    .input(updateDocumentInput)
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      const { id, ...data } = input;

      const updateData: Record<string, unknown> = {
        updatedById: user?.id,
      };

      if (data.title !== undefined) updateData.title = data.title;
      if (data.content !== undefined) updateData.content = data.content;
      if (data.type !== undefined) updateData.type = data.type;
      if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;

      const [doc] = await ctx.db
        .update(projectDocuments)
        .set(updateData)
        .where(eq(projectDocuments.id, id))
        .returning();

      return doc;
    }),

  getAgentContext: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        taskId: z.string().uuid().optional(),
        categories: z.array(agentDocCategoryEnum).optional(),
        limitPerCategory: z.number().int().min(1).max(50).default(12),
      })
    )
    .query(async ({ ctx, input }) => {
      const activeCategories = input.categories?.length
        ? input.categories
        : [
            "brd",
            "detailed_requirements",
            "epics",
            "tasks",
            "design_docs",
            "team_paradigms",
          ];

      const limit = input.limitPerCategory;

      let focusedTask: {
        id: string;
        title: string;
        identifier: string;
        status: string;
        type: string;
        description: string | null;
        funnelArtifactType: string | null;
        funnelStage: string | null;
      } | null = null;

      if (input.taskId) {
        const [task] = await ctx.db
          .select({
            id: issues.id,
            title: issues.title,
            identifier: issues.identifier,
            status: issues.status,
            type: issues.type,
            description: issues.description,
            funnelArtifactType: issues.funnelArtifactType,
            funnelStage: issues.funnelStage,
          })
          .from(issues)
          .where(and(eq(issues.id, input.taskId), eq(issues.projectId, input.projectId)))
          .limit(1);

        focusedTask = task ?? null;
      }

      const taskTerms = getWordsFromTask(focusedTask);

      const allDocs = await ctx.db
        .select()
        .from(projectDocuments)
        .where(eq(projectDocuments.projectId, input.projectId))
        .orderBy(desc(projectDocuments.updatedAt));

      const allIssues = await ctx.db
        .select({
          id: issues.id,
          title: issues.title,
          identifier: issues.identifier,
          status: issues.status,
          type: issues.type,
          description: issues.description,
          funnelArtifactType: issues.funnelArtifactType,
          funnelStage: issues.funnelStage,
          createdAt: issues.createdAt,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .where(eq(issues.projectId, input.projectId))
        .orderBy(desc(issues.updatedAt));

      const taskList = allIssues.filter((task) => isTaskRelevant(task, taskTerms));
      const contextIssues = taskList.slice(0, Math.max(limit * 2, limit + 8));
      const { artifactIndex: focusedArtifactIndex } = getFunnelOrdering(focusedTask);

      const upstreamArtifacts = focusedArtifactIndex >= 0
        ? allIssues
            .filter((issue) => {
              if (issue.id === focusedTask?.id) {
                return false;
              }

              const issueOrdering = getFunnelOrdering(issue);
              return issueOrdering.artifactIndex >= 0 && issueOrdering.artifactIndex < focusedArtifactIndex;
            })
            .sort((left, right) => {
              const leftOrdering = getFunnelOrdering(left);
              const rightOrdering = getFunnelOrdering(right);

              if (leftOrdering.artifactIndex !== rightOrdering.artifactIndex) {
                return leftOrdering.artifactIndex - rightOrdering.artifactIndex;
              }

              if (leftOrdering.stageIndex !== rightOrdering.stageIndex) {
                return leftOrdering.stageIndex - rightOrdering.stageIndex;
              }

              return right.updatedAt.getTime() - left.updatedAt.getTime();
            })
            .slice(0, limit * 2)
        : [];

      const buckets: Record<AgentDocCategory, Array<(typeof allDocs)[number]>> = {
        brd: [],
        detailed_requirements: [],
        epics: [],
        tasks: [],
        design_docs: [],
        team_paradigms: [],
      };

      for (const doc of allDocs) {
        const lowerTitle = normalizeText(doc.title);
        const lowerContent = normalizeText(doc.content);
        const matchText = `${lowerTitle} ${lowerContent}`;
        const docType = normalizeText(doc.type);

        const isRelevant = isTaskRelevant(
          { title: doc.title, description: doc.content },
          taskTerms
        );
        if (!isRelevant) {
          continue;
        }

        const hasCategorySignal = (category: string, typeNames: string[]): number => {
          const typeMatch = typeNames.some((name) => name === docType);
          const keywordMatch = getDocumentScore(matchText, getCategoryTerms(category));
          return (typeMatch ? 2 : 0) + keywordMatch;
        };

        for (const category of activeCategories) {
          if (category === "epics") {
            const score = hasCategorySignal("epics", ["roadmap", "planning", "epic"]);
            if (score > 0 && buckets.epics.length < limit) {
              buckets.epics.push(doc);
            }
            continue;
          }

          if (category === "tasks") {
            continue;
          }

          if (category === "brd") {
            const score = hasCategorySignal("brd", ["planning", "spec", "brd"]);
            if (score > 0 && buckets.brd.length < limit) {
              buckets.brd.push(doc);
            }
            continue;
          }

          if (category === "detailed_requirements") {
            const score = hasCategorySignal("detailed_requirements", [
              "spec",
              "planning",
              "detailed_requirements",
              "other",
            ]);
            if (score > 0 && buckets.detailed_requirements.length < limit) {
              buckets.detailed_requirements.push(doc);
            }
            continue;
          }

          if (category === "design_docs") {
            const score = hasCategorySignal("design_docs", [
              "design",
              "design_doc",
              "spec",
            ]);
            if (score > 0 && buckets.design_docs.length < limit) {
              buckets.design_docs.push(doc);
            }
            continue;
          }

          if (category === "team_paradigms") {
            const score = hasCategorySignal("team_paradigms", [
              "notes",
              "team_paradigm",
              "other",
            ]);
            if (score > 0 && buckets.team_paradigms.length < limit) {
              buckets.team_paradigms.push(doc);
            }
          }
        }
      }

      const epicIssues = contextIssues
        .filter((task) => task.type === "epic")
        .slice(0, limit);
      const taskIssues = contextIssues
        .filter((task) => task.type !== "epic")
        .slice(0, limit);

      return {
        projectId: input.projectId,
        taskContext: focusedTask,
        requestedCategories: activeCategories,
        upstreamArtifacts,
        docs: {
          brd: buckets.brd,
          detailedRequirements: buckets.detailed_requirements,
          epics: buckets.epics,
          designDocs: buckets.design_docs,
          teamParadigms: buckets.team_paradigms,
        },
        tasks: activeCategories.includes("tasks") ? taskIssues : [],
        epics: activeCategories.includes("epics") ? epicIssues : [],
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(projectDocuments)
        .where(eq(projectDocuments.id, input.id));

      return { success: true };
    }),

  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const docs = await ctx.db
        .select({
          id: projectDocuments.id,
          projectId: projectDocuments.projectId,
          title: projectDocuments.title,
          type: projectDocuments.type,
          createdAt: projectDocuments.createdAt,
          updatedAt: projectDocuments.updatedAt,
          projectName: projects.name,
          projectKey: projects.key,
        })
        .from(projectDocuments)
        .innerJoin(projects, eq(projectDocuments.projectId, projects.id))
        .where(eq(projects.workspaceId, input.workspaceId))
        .orderBy(desc(projectDocuments.updatedAt));

      return docs;
    }),
});
