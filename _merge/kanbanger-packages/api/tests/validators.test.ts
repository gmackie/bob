import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  forgeRepositories,
  forgeRevisions,
  forgeRunOverlays,
  forgeStacks,
  forgeBuildArtifacts,
  forgeBuildEvents,
  forgeBuilds,
  forgeDeployments,
  forgePreviews,
  integrationTypeEnum,
  agentTaskRunStatusEnum,
  executionBackendEnum,
  issueArtifacts,
} from "@linear-clone/db";

// Test the validation schemas used in routers
describe("Issue Input Validation", () => {
  const createIssueSchema = z.object({
    teamId: z.string().uuid(),
    title: z.string().min(1).max(500),
    description: z.string().optional(),
    status: z
      .enum(["backlog", "todo", "in_progress", "in_review", "done", "canceled"])
      .optional(),
    priority: z
      .enum(["no_priority", "urgent", "high", "medium", "low"])
      .optional(),
    assigneeId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    cycleId: z.string().uuid().optional(),
    estimate: z.number().int().min(0).optional(),
  });

  it("should accept valid issue data", () => {
    const validData = {
      teamId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Fix login bug",
      description: "Users cannot log in on mobile",
      status: "todo" as const,
      priority: "high" as const,
    };

    const result = createIssueSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should reject empty title", () => {
    const invalidData = {
      teamId: "550e8400-e29b-41d4-a716-446655440000",
      title: "",
    };

    const result = createIssueSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should reject invalid UUID", () => {
    const invalidData = {
      teamId: "not-a-uuid",
      title: "Test issue",
    };

    const result = createIssueSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should reject invalid status", () => {
    const invalidData = {
      teamId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Test issue",
      status: "invalid_status",
    };

    const result = createIssueSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should reject invalid priority", () => {
    const invalidData = {
      teamId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Test issue",
      priority: "super_high",
    };

    const result = createIssueSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should accept minimal valid data", () => {
    const minimalData = {
      teamId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Test issue",
    };

    const result = createIssueSchema.safeParse(minimalData);
    expect(result.success).toBe(true);
  });

  it("should reject title over 500 characters", () => {
    const invalidData = {
      teamId: "550e8400-e29b-41d4-a716-446655440000",
      title: "a".repeat(501),
    };

    const result = createIssueSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});

describe("Project Input Validation", () => {
  const createProjectSchema = z.object({
    workspaceId: z.string().uuid(),
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    status: z
      .enum(["backlog", "planned", "in_progress", "paused", "completed", "canceled"])
      .optional(),
    leadId: z.string().uuid().optional(),
    startDate: z.date().optional(),
    targetDate: z.date().optional(),
    teamIds: z.array(z.string().uuid()).optional(),
  });

  it("should accept valid project data", () => {
    const validData = {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Q1 Launch",
      description: "Launch the new product",
      status: "planned" as const,
    };

    const result = createProjectSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should accept project with dates", () => {
    const validData = {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Q1 Launch",
      startDate: new Date("2024-01-01"),
      targetDate: new Date("2024-03-31"),
    };

    const result = createProjectSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should reject empty name", () => {
    const invalidData = {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      name: "",
    };

    const result = createProjectSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});

describe("Bob Execution Backend Schema", () => {
  it("should expose bob as a valid integration type", () => {
    expect(integrationTypeEnum.enumValues).toContain("bob");
  });

  it("should expose new terminal agent run statuses", () => {
    expect(agentTaskRunStatusEnum.enumValues).toContain("superseded");
    expect(agentTaskRunStatusEnum.enumValues).toContain("failed_to_start");
  });

  it("should expose bob as a valid execution backend", () => {
    expect(executionBackendEnum.enumValues).toContain("bob");
  });

  it("should expose normalized issue artifact columns", () => {
    expect(issueArtifacts.issueId).toBeDefined();
    expect(issueArtifacts.agentTaskRunId).toBeDefined();
    expect(issueArtifacts.executionBackend).toBeDefined();
    expect(issueArtifacts.producerType).toBeDefined();
    expect(issueArtifacts.artifactType).toBeDefined();
    expect(issueArtifacts.url).toBeDefined();
    expect(issueArtifacts.isCurrent).toBeDefined();
  });
});

describe("Team Input Validation", () => {
  const createTeamSchema = z.object({
    workspaceId: z.string().uuid(),
    name: z.string().min(1).max(100),
    key: z
      .string()
      .min(2)
      .max(10)
      .regex(/^[A-Z]+$/),
    description: z.string().optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  });

  it("should accept valid team data", () => {
    const validData = {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Engineering",
      key: "ENG",
      description: "Engineering team",
      color: "#6366f1",
    };

    const result = createTeamSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should reject lowercase key", () => {
    const invalidData = {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Engineering",
      key: "eng",
    };

    const result = createTeamSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should reject key with numbers", () => {
    const invalidData = {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Engineering",
      key: "ENG1",
    };

    const result = createTeamSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should reject invalid color format", () => {
    const invalidData = {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Engineering",
      key: "ENG",
      color: "red",
    };

    const result = createTeamSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should accept single letter key (min 2)", () => {
    const invalidData = {
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Engineering",
      key: "E",
    };

    const result = createTeamSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});

describe("Cycle Input Validation", () => {
  const createCycleSchema = z.object({
    teamId: z.string().uuid(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
  });

  it("should accept valid cycle data", () => {
    const validData = {
      teamId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Sprint 1",
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-01-14"),
    };

    const result = createCycleSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should accept cycle without dates (auto-generated)", () => {
    const validData = {
      teamId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Sprint 1",
    };

    const result = createCycleSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should accept minimal cycle data", () => {
    const minimalData = {
      teamId: "550e8400-e29b-41d4-a716-446655440000",
    };

    const result = createCycleSchema.safeParse(minimalData);
    expect(result.success).toBe(true);
  });
});

describe("ForgeGraph Schema Exports", () => {
  it("should export forgegraph metadata tables", () => {
    expect(forgeRepositories).toBeDefined();
    expect(forgeRevisions).toBeDefined();
    expect(forgeStacks).toBeDefined();
    expect(forgeRunOverlays).toBeDefined();
  });
});

describe("ForgeGraph CI/CD Schema Exports", () => {
  it("should export forgegraph cicd tables", () => {
    expect(forgeBuilds).toBeDefined();
    expect(forgeBuildArtifacts).toBeDefined();
    expect(forgeDeployments).toBeDefined();
    expect(forgePreviews).toBeDefined();
    expect(forgeBuildEvents).toBeDefined();
  });
});
