# blder.bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the bob Go CLI binary that talks to the existing Bob backend, plus the multi-tenancy foundation in the TypeScript monorepo.

**Architecture:** Approach B (staged). Phase 0 adds tenants to the existing DB and builds the REST API endpoints on the current Bob backend. Phase 1 builds the Go CLI that talks to those endpoints. The vinext/Cloudflare migration happens later (Phase 2, separate plan).

**Tech Stack:** Go 1.23+ (CLI), TypeScript/Drizzle/tRPC (backend), PostgreSQL, Better Auth

---

## Phase 0: Foundation (TypeScript monorepo)

### Task 1: Add tenants table to DB schema

**Files:**
- Modify: `packages/db/src/schema.ts:387` (after workspaces table)
- Test: `packages/db/drizzle/` (migration output)

**Step 1: Add tenants and tenant_members tables**

Add after the `apiKeys` table definition (line 59) in `packages/db/src/schema.ts`:

```typescript
// --- Tenants ---

export const tenantPlanEnum = pgEnum("tenant_plan", [
  "free",
  "premium",
  "pro",
]);

export const tenantMemberRoleEnum = pgEnum("tenant_member_role", [
  "owner",
  "admin",
  "member",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  plan: tenantPlanEnum("plan").notNull().default("free"),
  forgeGraphProjectId: text("forge_graph_project_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: tenantMemberRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("tenant_members_tenant_user_idx").on(
      table.tenantId,
      table.userId,
    ),
  ],
);
```

**Step 2: Add tenants relations**

Add in the relations section of the schema:

```typescript
export const tenantsRelations = relations(tenants, ({ many }) => ({
  members: many(tenantMembers),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantMembers.tenantId],
    references: [tenants.id],
  }),
}));
```

**Step 3: Run the migration**

Run: `cd /Volumes/dev/bob && pnpm db:push`
Expected: Tables `tenants` and `tenant_members` created in PostgreSQL.

**Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat: add tenants and tenant_members tables"
```

---

### Task 2: Add tenantId to workspaces table

**Files:**
- Modify: `packages/db/src/schema.ts:387-400` (workspaces table)
- Modify: `packages/db/src/schema.ts:760-767` (workspaces relations)

**Step 1: Add tenantId, machineId, lastHeartbeat, agentConfigs columns to workspaces**

In the workspaces table definition (line ~387), add these columns:

```typescript
tenantId: uuid("tenant_id").references(() => tenants.id, {
  onDelete: "cascade",
}),
machineId: text("machine_id"),
lastHeartbeat: timestamp("last_heartbeat"),
agentConfigs: json("agent_configs").$type<Record<string, unknown>>(),
```

Note: `tenantId` is nullable initially so the migration doesn't break existing rows. We'll backfill in Task 3.

**Step 2: Add tenant relation to workspaces relations**

Update the workspacesRelations (line ~760) to add:

```typescript
tenant: one(tenants, {
  fields: [workspaces.tenantId],
  references: [tenants.id],
}),
```

**Step 3: Run the migration**

Run: `cd /Volumes/dev/bob && pnpm db:push`
Expected: Columns added to workspaces table.

**Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat: add tenantId, machineId, heartbeat, agentConfigs to workspaces"
```

---

### Task 3: Add agent_runs and run_artifacts tables

**Files:**
- Modify: `packages/db/src/schema.ts` (add after tenants tables)

**Step 1: Add the tables**

```typescript
// --- Agent Runs ---

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workItemId: text("work_item_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentType: varchar("agent_type", { length: 64 }).notNull(),
    agentConfig: json("agent_config").$type<Record<string, unknown>>(),
    status: agentRunStatusEnum("status").notNull().default("queued"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    summary: json("summary").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("agent_runs_workspace_idx").on(table.workspaceId),
    index("agent_runs_tenant_idx").on(table.tenantId),
    index("agent_runs_work_item_idx").on(table.workItemId),
  ],
);

export const runArtifactTypeEnum = pgEnum("run_artifact_type", [
  "diff",
  "log",
  "test-report",
  "file-snapshot",
]);

export const runArtifacts = pgTable(
  "run_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    type: runArtifactTypeEnum("type").notNull(),
    storageKey: text("storage_key").notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("run_artifacts_run_idx").on(table.runId)],
);

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [agentRuns.workspaceId],
    references: [workspaces.id],
  }),
  tenant: one(tenants, {
    fields: [agentRuns.tenantId],
    references: [tenants.id],
  }),
  artifacts: many(runArtifacts),
}));

export const runArtifactsRelations = relations(runArtifacts, ({ one }) => ({
  run: one(agentRuns, {
    fields: [runArtifacts.runId],
    references: [agentRuns.id],
  }),
}));
```

**Step 2: Run the migration**

Run: `cd /Volumes/dev/bob && pnpm db:push`
Expected: `agent_runs` and `run_artifacts` tables created.

**Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat: add agent_runs and run_artifacts tables"
```

---

### Task 4: Seed tenant #1 and backfill existing data

**Files:**
- Create: `packages/db/src/seed-tenant.ts`

**Step 1: Write the seed script**

```typescript
import { db } from "./client";
import { tenants, tenantMembers, workspaces } from "./schema";
import { eq, isNull } from "drizzle-orm";

async function seedTenant() {
  // Create tenant #1 (your dogfood instance)
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: "gmackie",
      slug: "gmackie",
      plan: "pro",
    })
    .onConflictDoNothing()
    .returning();

  if (!tenant) {
    console.log("Tenant already exists, finding it...");
    const [existing] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, "gmackie"));
    if (!existing) throw new Error("Could not find or create tenant");
    console.log(`Found tenant: ${existing.id}`);

    // Backfill workspaces that have no tenantId
    const updated = await db
      .update(workspaces)
      .set({ tenantId: existing.id })
      .where(isNull(workspaces.tenantId));
    console.log(`Backfilled ${updated.rowCount} workspaces`);
    return;
  }

  console.log(`Created tenant: ${tenant.id}`);

  // Backfill all existing workspaces to tenant #1
  const updated = await db
    .update(workspaces)
    .set({ tenantId: tenant.id })
    .where(isNull(workspaces.tenantId));
  console.log(`Backfilled ${updated.rowCount} workspaces`);

  // Add workspace owners as tenant members
  const allWorkspaces = await db.select().from(workspaces);
  for (const ws of allWorkspaces) {
    if (ws.ownerUserId) {
      await db
        .insert(tenantMembers)
        .values({
          tenantId: tenant.id,
          userId: ws.ownerUserId,
          role: "owner",
        })
        .onConflictDoNothing();
    }
  }
  console.log("Tenant members created from workspace owners");
}

seedTenant()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

**Step 2: Run the seed**

Run: `cd /Volumes/dev/bob && pnpm -F @bob/db exec tsx src/seed-tenant.ts`
Expected: Tenant #1 created, existing workspaces backfilled with tenantId.

**Step 3: Commit**

```bash
git add packages/db/src/seed-tenant.ts
git commit -m "feat: seed tenant #1 and backfill existing workspaces"
```

---

### Task 5: Add tenant-scoped REST API router

**Files:**
- Create: `packages/api/src/router/publicApi.ts`
- Modify: `packages/api/src/root.ts:42-78` (add router)

**Step 1: Create the public API router**

This router handles the `/v1/*` REST endpoints that the bob CLI will call. For Phase 1, the bob CLI talks to the existing Bob tRPC backend, so these are tRPC procedures that mirror the REST API contract.

```typescript
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  agentRuns,
  runArtifacts,
  workspaces,
  tenants,
  tenantMembers,
} from "@bob/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const publicApiRouter = createTRPCRouter({
  // POST /workspaces — register a workspace
  registerWorkspace: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        slug: z.string().regex(/^[a-z0-9-]+$/).max(64),
        machineId: z.string().min(1),
        repoPath: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find user's tenant
      const membership = await ctx.db.query.tenantMembers.findFirst({
        where: eq(tenantMembers.userId, ctx.session.user.id),
        with: { tenant: true },
      });
      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No tenant found for user",
        });
      }

      const [workspace] = await ctx.db
        .insert(workspaces)
        .values({
          name: input.name,
          slug: input.slug,
          ownerUserId: ctx.session.user.id,
          tenantId: membership.tenantId,
          machineId: input.machineId,
          lastHeartbeat: new Date(),
        })
        .returning();

      return workspace;
    }),

  // POST /runs — create an agent run
  createRun: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().min(1),
        workspaceId: z.string().uuid(),
        agentType: z.string().min(1).max(64),
        agentConfig: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify workspace belongs to user's tenant
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!workspace?.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const [run] = await ctx.db
        .insert(agentRuns)
        .values({
          workItemId: input.workItemId,
          workspaceId: input.workspaceId,
          tenantId: workspace.tenantId,
          agentType: input.agentType,
          agentConfig: input.agentConfig ?? {},
          status: "queued",
        })
        .returning();

      return run;
    }),

  // PATCH /runs/:id — update run status
  updateRun: protectedProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        status: z.enum(["running", "completed", "failed"]),
        summary: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const updates: Record<string, unknown> = { status: input.status };

      if (input.status === "running") updates.startedAt = now;
      if (input.status === "completed" || input.status === "failed")
        updates.completedAt = now;
      if (input.summary) updates.summary = input.summary;

      const [updated] = await ctx.db
        .update(agentRuns)
        .set(updates)
        .where(eq(agentRuns.id, input.runId))
        .returning();

      return updated;
    }),

  // POST /runs/:id/artifacts — upload artifact metadata
  createArtifact: protectedProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        type: z.enum(["diff", "log", "test-report", "file-snapshot"]),
        storageKey: z.string().min(1),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [artifact] = await ctx.db
        .insert(runArtifacts)
        .values({
          runId: input.runId,
          type: input.type,
          storageKey: input.storageKey,
          metadata: input.metadata ?? {},
        })
        .returning();

      return artifact;
    }),

  // GET /runs/:id — get run with artifacts
  getRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.agentRuns.findFirst({
        where: eq(agentRuns.id, input.runId),
        with: { artifacts: true },
      });
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return run;
    }),

  // GET /runs — list runs for a workspace
  listRuns: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.agentRuns.findMany({
        where: eq(agentRuns.workspaceId, input.workspaceId),
        with: { artifacts: true },
        orderBy: [desc(agentRuns.createdAt)],
        limit: input.limit,
      });
    }),

  // POST /workspaces/:id/heartbeat
  heartbeat: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(workspaces)
        .set({ lastHeartbeat: new Date() })
        .where(eq(workspaces.id, input.workspaceId));
      return { ok: true };
    }),
});
```

**Step 2: Register the router in root.ts**

In `packages/api/src/root.ts`, add to the imports:

```typescript
import { publicApiRouter } from "./router/publicApi";
```

Add to the `appRouterRecord` object:

```typescript
publicApi: publicApiRouter,
```

**Step 3: Verify typecheck passes**

Run: `cd /Volumes/dev/bob && pnpm typecheck`
Expected: No type errors.

**Step 4: Commit**

```bash
git add packages/api/src/router/publicApi.ts packages/api/src/root.ts
git commit -m "feat: add publicApi router for bob CLI endpoints"
```

---

### Task 6: Add API key generation endpoint

**Files:**
- Modify: `packages/api/src/router/publicApi.ts` (add procedure)
- Reference: `packages/auth/src/api-key.ts:17-19` (hashApiKey function)

**Step 1: Add generateApiKey procedure**

Add to the publicApiRouter in `publicApi.ts`:

```typescript
import { randomBytes, createHash } from "crypto";
import { apiKeys } from "@bob/db/schema";

// Inside the router:
generateApiKey: protectedProcedure
  .input(
    z.object({
      name: z.string().min(1).max(100).default("bob-cli"),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const rawKey = `bob_${randomBytes(32).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12);

    const [apiKey] = await ctx.db
      .insert(apiKeys)
      .values({
        userId: ctx.session.user.id,
        name: input.name,
        keyHash,
        keyPrefix,
        permissions: ["read", "write"],
      })
      .returning();

    // Return the raw key ONCE — it can never be retrieved again
    return { id: apiKey.id, key: rawKey, prefix: keyPrefix };
  }),
```

**Step 2: Verify typecheck**

Run: `cd /Volumes/dev/bob && pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/api/src/router/publicApi.ts
git commit -m "feat: add API key generation for bob CLI auth"
```

---

## Phase 1: bob CLI (Go binary — separate repo)

> **Note:** Tasks 7+ happen in a new repo. Create `~/dev/bob-cli` (or wherever you prefer). This is the `blder/bob` repo.

### Task 7: Scaffold Go module

**Files:**
- Create: `go.mod`
- Create: `main.go`
- Create: `cmd/root.go`

**Step 1: Initialize the Go module**

```bash
mkdir -p ~/dev/bob-cli && cd ~/dev/bob-cli
go mod init github.com/blder/bob
```

**Step 2: Create main.go**

```go
package main

import "github.com/blder/bob/cmd"

func main() {
	cmd.Execute()
}
```

**Step 3: Create cmd/root.go**

```go
package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "bob",
	Short: "blder.bot CLI — launch and monitor coding agents",
	Long:  "bob is the local runtime for blder.bot. It launches coding agents, collects artifacts, and reports results.",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().StringP("config", "c", "", "config file (default ~/.config/bob/config.yaml)")
}
```

**Step 4: Add cobra dependency**

```bash
go get github.com/spf13/cobra@latest
go mod tidy
```

**Step 5: Verify it builds**

Run: `go build -o bob .`
Run: `./bob --help`
Expected: Help output showing "blder.bot CLI — launch and monitor coding agents"

**Step 6: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold bob CLI with cobra"
```

---

### Task 8: Add config management

**Files:**
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`

**Step 1: Write the failing test**

```go
package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig_Default(t *testing.T) {
	dir := t.TempDir()
	cfg, err := Load(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.APIBaseURL != "https://bob.tail1e1a32.ts.net" {
		t.Errorf("expected default API URL, got %s", cfg.APIBaseURL)
	}
	if cfg.DefaultAgent != "" {
		t.Errorf("expected empty default agent, got %s", cfg.DefaultAgent)
	}
}

func TestLoadConfig_FromFile(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	content := []byte(`api_base_url: https://custom.example.com
default_agent: claude-code
agents:
  claude-code:
    command: claude
    args: ["--print"]
`)
	if err := os.WriteFile(cfgPath, content, 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.APIBaseURL != "https://custom.example.com" {
		t.Errorf("expected custom URL, got %s", cfg.APIBaseURL)
	}
	if cfg.DefaultAgent != "claude-code" {
		t.Errorf("expected claude-code, got %s", cfg.DefaultAgent)
	}
	agent, ok := cfg.Agents["claude-code"]
	if !ok {
		t.Fatal("claude-code agent not found")
	}
	if agent.Command != "claude" {
		t.Errorf("expected claude command, got %s", agent.Command)
	}
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./internal/config/ -v`
Expected: FAIL — types not defined

**Step 3: Write the implementation**

```go
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type AgentConfig struct {
	Command    string            `yaml:"command"`
	Args       []string          `yaml:"args,omitempty"`
	Env        map[string]string `yaml:"env,omitempty"`
	FirstClass bool              `yaml:"first_class,omitempty"`
}

type Config struct {
	APIBaseURL   string                  `yaml:"api_base_url"`
	APIKey       string                  `yaml:"api_key,omitempty"`
	DefaultAgent string                  `yaml:"default_agent,omitempty"`
	Agents       map[string]AgentConfig  `yaml:"agents,omitempty"`
	WorkspaceID  string                  `yaml:"workspace_id,omitempty"`
}

func DefaultConfigPath() string {
	home, _ := os.UserHomeDir()
	return home + "/.config/bob/config.yaml"
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		APIBaseURL: "https://bob.tail1e1a32.ts.net",
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, err
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) Save(path string) error {
	dir := path[:len(path)-len("/config.yaml")]
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}
```

**Step 4: Add yaml dependency and run tests**

```bash
go get gopkg.in/yaml.v3
go mod tidy
```

Run: `go test ./internal/config/ -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/config/ go.mod go.sum
git commit -m "feat: add config management with YAML support"
```

---

### Task 9: Add API client

**Files:**
- Create: `internal/api/client.go`
- Create: `internal/api/client_test.go`

**Step 1: Write the failing test**

```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClient_CreateRun(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("expected Bearer test-key, got %s", r.Header.Get("Authorization"))
		}
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}

		var body CreateRunRequest
		json.NewDecoder(r.Body).Decode(&body)
		if body.WorkItemID != "WI-1" {
			t.Errorf("expected WI-1, got %s", body.WorkItemID)
		}

		json.NewEncoder(w).Encode(AgentRun{
			ID:     "run-123",
			Status: "queued",
		})
	}))
	defer server.Close()

	client := New(server.URL, "test-key")
	run, err := client.CreateRun(CreateRunRequest{
		WorkItemID:  "WI-1",
		WorkspaceID: "ws-1",
		AgentType:   "claude-code",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if run.ID != "run-123" {
		t.Errorf("expected run-123, got %s", run.ID)
	}
}
```

**Step 2: Run test to verify failure**

Run: `go test ./internal/api/ -v`
Expected: FAIL — types not defined

**Step 3: Write the implementation**

```go
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

type AgentRun struct {
	ID          string                 `json:"id"`
	WorkItemID  string                 `json:"workItemId"`
	WorkspaceID string                 `json:"workspaceId"`
	AgentType   string                 `json:"agentType"`
	Status      string                 `json:"status"`
	Summary     map[string]interface{} `json:"summary,omitempty"`
	StartedAt   *time.Time             `json:"startedAt,omitempty"`
	CompletedAt *time.Time             `json:"completedAt,omitempty"`
}

type CreateRunRequest struct {
	WorkItemID  string                 `json:"workItemId"`
	WorkspaceID string                 `json:"workspaceId"`
	AgentType   string                 `json:"agentType"`
	AgentConfig map[string]interface{} `json:"agentConfig,omitempty"`
}

type UpdateRunRequest struct {
	Status  string                 `json:"status"`
	Summary map[string]interface{} `json:"summary,omitempty"`
}

type Artifact struct {
	ID         string                 `json:"id"`
	RunID      string                 `json:"runId"`
	Type       string                 `json:"type"`
	StorageKey string                 `json:"storageKey"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

type CreateArtifactRequest struct {
	Type       string                 `json:"type"`
	StorageKey string                 `json:"storageKey"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

func New(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) do(method, path string, body interface{}) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.BaseURL+path, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

func (c *Client) CreateRun(req CreateRunRequest) (*AgentRun, error) {
	data, err := c.do("POST", "/v1/runs", req)
	if err != nil {
		return nil, err
	}
	var run AgentRun
	return &run, json.Unmarshal(data, &run)
}

func (c *Client) UpdateRun(runID string, req UpdateRunRequest) (*AgentRun, error) {
	data, err := c.do("PATCH", "/v1/runs/"+runID, req)
	if err != nil {
		return nil, err
	}
	var run AgentRun
	return &run, json.Unmarshal(data, &run)
}

func (c *Client) CreateArtifact(runID string, req CreateArtifactRequest) (*Artifact, error) {
	data, err := c.do("POST", "/v1/runs/"+runID+"/artifacts", req)
	if err != nil {
		return nil, err
	}
	var artifact Artifact
	return &artifact, json.Unmarshal(data, &artifact)
}

func (c *Client) GetRun(runID string) (*AgentRun, error) {
	data, err := c.do("GET", "/v1/runs/"+runID, nil)
	if err != nil {
		return nil, err
	}
	var run AgentRun
	return &run, json.Unmarshal(data, &run)
}
```

**Step 4: Run tests**

Run: `go test ./internal/api/ -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/api/ go.mod go.sum
git commit -m "feat: add API client for blder.bot communication"
```

---

### Task 10: Add agent launcher

**Files:**
- Create: `internal/agent/launcher.go`
- Create: `internal/agent/launcher_test.go`

**Step 1: Write the failing test**

```go
package agent

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/blder/bob/internal/config"
)

func TestLaunch_Success(t *testing.T) {
	// Create a fake agent script
	dir := t.TempDir()
	script := filepath.Join(dir, "fake-agent.sh")
	os.WriteFile(script, []byte("#!/bin/sh\necho 'hello from agent'\nexit 0\n"), 0755)

	cfg := config.AgentConfig{
		Command: script,
	}

	result, err := Launch(context.Background(), cfg, dir, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.ExitCode != 0 {
		t.Errorf("expected exit 0, got %d", result.ExitCode)
	}
	if len(result.Stdout) == 0 {
		t.Error("expected stdout output")
	}
}

func TestLaunch_AgentNotFound(t *testing.T) {
	cfg := config.AgentConfig{
		Command: "/nonexistent/agent",
	}

	_, err := Launch(context.Background(), cfg, t.TempDir(), nil)
	if err == nil {
		t.Fatal("expected error for missing agent")
	}
}

func TestLaunch_AgentCrash(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "crash-agent.sh")
	os.WriteFile(script, []byte("#!/bin/sh\nexit 1\n"), 0755)

	cfg := config.AgentConfig{
		Command: script,
	}

	result, err := Launch(context.Background(), cfg, dir, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.ExitCode != 1 {
		t.Errorf("expected exit 1, got %d", result.ExitCode)
	}
}
```

**Step 2: Run test to verify failure**

Run: `go test ./internal/agent/ -v`
Expected: FAIL — types not defined

**Step 3: Write the implementation**

```go
package agent

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/blder/bob/internal/config"
)

type Result struct {
	ExitCode  int
	Stdout    []byte
	Stderr    []byte
	Duration  time.Duration
	StartedAt time.Time
}

func Launch(ctx context.Context, cfg config.AgentConfig, workDir string, extraEnv map[string]string) (*Result, error) {
	args := cfg.Args
	cmd := exec.CommandContext(ctx, cfg.Command, args...)
	cmd.Dir = workDir

	// Build environment
	cmd.Env = os.Environ()
	for k, v := range cfg.Env {
		// Only resolve env var references, not shell expansion
		resolved := os.ExpandEnv(v)
		cmd.Env = append(cmd.Env, k+"="+resolved)
	}
	for k, v := range extraEnv {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	duration := time.Since(start)

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return nil, fmt.Errorf("failed to launch agent %q: %w", cfg.Command, err)
		}
	}

	return &Result{
		ExitCode:  exitCode,
		Stdout:    stdout.Bytes(),
		Stderr:    stderr.Bytes(),
		Duration:  duration,
		StartedAt: start,
	}, nil
}
```

**Step 4: Run tests**

Run: `go test ./internal/agent/ -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/agent/
git commit -m "feat: add agent launcher with subprocess management"
```

---

### Task 11: Add artifact collector

**Files:**
- Create: `internal/artifacts/collector.go`
- Create: `internal/artifacts/collector_test.go`

**Step 1: Write the failing test**

```go
package artifacts

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestCollectDiff(t *testing.T) {
	// Set up a git repo with a change
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com", "GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com")
		if err := cmd.Run(); err != nil {
			t.Fatalf("command %v failed: %v", args, err)
		}
	}

	run("git", "init")
	os.WriteFile(filepath.Join(dir, "file.txt"), []byte("original"), 0644)
	run("git", "add", ".")
	run("git", "commit", "-m", "initial")
	os.WriteFile(filepath.Join(dir, "file.txt"), []byte("modified"), 0644)

	diff, err := CollectDiff(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if diff.FilesChanged != 1 {
		t.Errorf("expected 1 file changed, got %d", diff.FilesChanged)
	}
	if len(diff.RawDiff) == 0 {
		t.Error("expected non-empty diff")
	}
}
```

**Step 2: Run test to verify failure**

Run: `go test ./internal/artifacts/ -v`
Expected: FAIL

**Step 3: Write the implementation**

```go
package artifacts

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

type DiffResult struct {
	FilesChanged int
	Insertions   int
	Deletions    int
	Files        []FileChange
	RawDiff      string
}

type FileChange struct {
	Path   string
	Status string // added, modified, deleted
}

func CollectDiff(workDir string) (*DiffResult, error) {
	// Get the raw diff
	diffCmd := exec.Command("git", "diff", "HEAD")
	diffCmd.Dir = workDir
	rawDiff, err := diffCmd.Output()
	if err != nil {
		// Try unstaged diff
		diffCmd = exec.Command("git", "diff")
		diffCmd.Dir = workDir
		rawDiff, err = diffCmd.Output()
		if err != nil {
			return nil, fmt.Errorf("git diff: %w", err)
		}
	}

	// Get the stat
	statCmd := exec.Command("git", "diff", "--stat", "--numstat")
	statCmd.Dir = workDir
	statOutput, _ := statCmd.Output()

	result := &DiffResult{
		RawDiff: string(rawDiff),
	}

	// Parse numstat output
	for _, line := range strings.Split(string(statOutput), "\n") {
		parts := strings.Fields(line)
		if len(parts) >= 3 {
			add, _ := strconv.Atoi(parts[0])
			del, _ := strconv.Atoi(parts[1])
			result.Insertions += add
			result.Deletions += del
			result.FilesChanged++
			result.Files = append(result.Files, FileChange{
				Path:   parts[2],
				Status: "modified",
			})
		}
	}

	return result, nil
}

type LogResult struct {
	Lines         int
	Content       string
	AgentExitCode int
}

func CollectLog(stdout, stderr []byte, exitCode int) *LogResult {
	combined := string(stdout) + string(stderr)
	lines := strings.Count(combined, "\n")
	return &LogResult{
		Lines:         lines,
		Content:       combined,
		AgentExitCode: exitCode,
	}
}
```

**Step 4: Run tests**

Run: `go test ./internal/artifacts/ -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/artifacts/
git commit -m "feat: add artifact collector for git diffs and logs"
```

---

### Task 12: Add `bob run` command

**Files:**
- Create: `cmd/run.go`

**Step 1: Write the run command**

```go
package cmd

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/blder/bob/internal/agent"
	"github.com/blder/bob/internal/api"
	"github.com/blder/bob/internal/artifacts"
	"github.com/blder/bob/internal/config"
	"github.com/spf13/cobra"
)

var runCmd = &cobra.Command{
	Use:   "run <work-item-id>",
	Short: "Launch an agent for a work item",
	Args:  cobra.ExactArgs(1),
	RunE:  runRun,
}

func init() {
	rootCmd.AddCommand(runCmd)
	runCmd.Flags().StringP("agent", "a", "", "agent to use (default from config)")
	runCmd.Flags().DurationP("timeout", "t", 30*time.Minute, "agent timeout")
}

func runRun(cmd *cobra.Command, args []string) error {
	workItemID := args[0]

	// Load config
	cfgPath, _ := cmd.Flags().GetString("config")
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath()
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if cfg.APIKey == "" {
		return fmt.Errorf("not authenticated. Run `bob login` first.")
	}
	if cfg.WorkspaceID == "" {
		return fmt.Errorf("no workspace configured. Run `bob init` first.")
	}

	// Determine agent
	agentName, _ := cmd.Flags().GetString("agent")
	if agentName == "" {
		agentName = cfg.DefaultAgent
	}
	if agentName == "" {
		return fmt.Errorf("no agent specified. Use --agent or set default_agent in config.")
	}

	agentCfg, ok := cfg.Agents[agentName]
	if !ok {
		return fmt.Errorf("agent %q not found in config. Available: %v", agentName, agentNames(cfg))
	}

	client := api.New(cfg.APIBaseURL, cfg.APIKey)
	workDir, _ := os.Getwd()

	// Create run
	fmt.Printf("  Pulling plan from blder.bot... ")
	run, err := client.CreateRun(api.CreateRunRequest{
		WorkItemID:  workItemID,
		WorkspaceID: cfg.WorkspaceID,
		AgentType:   agentName,
	})
	if err != nil {
		return fmt.Errorf("create run: %w", err)
	}
	fmt.Println("done")

	// Update to running
	client.UpdateRun(run.ID, api.UpdateRunRequest{Status: "running"})

	// Launch agent
	fmt.Printf("  Launching %s... ", agentName)
	timeout, _ := cmd.Flags().GetDuration("timeout")
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	result, err := agent.Launch(ctx, agentCfg, workDir, nil)
	if err != nil {
		client.UpdateRun(run.ID, api.UpdateRunRequest{Status: "failed"})
		return fmt.Errorf("agent %q not found in PATH. Install it or update config: %w", agentCfg.Command, err)
	}
	fmt.Printf("completed (exit %d)\n", result.ExitCode)

	// Collect artifacts
	fmt.Println("  Collecting artifacts...")
	diff, _ := artifacts.CollectDiff(workDir)
	if diff != nil && diff.FilesChanged > 0 {
		fmt.Printf("    diff: +%d -%d across %d files\n", diff.Insertions, diff.Deletions, diff.FilesChanged)
	}

	log := artifacts.CollectLog(result.Stdout, result.Stderr, result.ExitCode)
	fmt.Printf("    log: %d lines captured\n", log.Lines)

	// Upload artifacts
	fmt.Printf("  Uploading to blder.bot... ")
	if diff != nil && diff.FilesChanged > 0 {
		client.CreateArtifact(run.ID, api.CreateArtifactRequest{
			Type:       "diff",
			StorageKey: fmt.Sprintf("runs/%s/diff.patch", run.ID),
			Metadata: map[string]interface{}{
				"files_changed": diff.FilesChanged,
				"insertions":    diff.Insertions,
				"deletions":     diff.Deletions,
			},
		})
	}

	client.CreateArtifact(run.ID, api.CreateArtifactRequest{
		Type:       "log",
		StorageKey: fmt.Sprintf("runs/%s/agent.log", run.ID),
		Metadata: map[string]interface{}{
			"lines":           log.Lines,
			"agent_exit_code": log.AgentExitCode,
		},
	})

	// Update run status
	status := "completed"
	if result.ExitCode != 0 {
		status = "failed"
	}
	client.UpdateRun(run.ID, api.UpdateRunRequest{
		Status: status,
		Summary: map[string]interface{}{
			"exit_code":     result.ExitCode,
			"duration_ms":   result.Duration.Milliseconds(),
			"files_changed": diff.FilesChanged,
		},
	})
	fmt.Println("done")

	fmt.Printf("  View results: %s/runs/%s\n", cfg.APIBaseURL, run.ID)
	return nil
}

func agentNames(cfg *config.Config) []string {
	names := make([]string, 0, len(cfg.Agents))
	for name := range cfg.Agents {
		names = append(names, name)
	}
	return names
}
```

**Step 2: Verify it builds**

Run: `go build -o bob .`
Run: `./bob run --help`
Expected: Help output for the run command

**Step 3: Commit**

```bash
git add cmd/run.go
git commit -m "feat: add bob run command with fire-and-report"
```

---

### Task 13: Add `bob login` command

**Files:**
- Create: `cmd/login.go`

**Step 1: Write the login command**

This opens a browser for GitHub OAuth, then stores the API key locally.

```go
package cmd

import (
	"fmt"
	"os"

	"github.com/blder/bob/internal/config"
	"github.com/spf13/cobra"
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with blder.bot",
	RunE:  runLogin,
}

func init() {
	rootCmd.AddCommand(loginCmd)
	loginCmd.Flags().String("api-key", "", "provide API key directly (skip browser flow)")
}

func runLogin(cmd *cobra.Command, args []string) error {
	cfgPath, _ := cmd.Flags().GetString("config")
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath()
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	apiKey, _ := cmd.Flags().GetString("api-key")

	if apiKey == "" {
		// For v0, direct API key input. OAuth device flow comes later.
		fmt.Println("To authenticate, generate an API key at your blder.bot settings page.")
		fmt.Printf("API Base URL: %s\n", cfg.APIBaseURL)
		fmt.Print("\nPaste your API key: ")
		fmt.Scanln(&apiKey)
	}

	if apiKey == "" {
		return fmt.Errorf("no API key provided")
	}

	cfg.APIKey = apiKey
	if err := cfg.Save(cfgPath); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Println("Authenticated successfully. Config saved to", cfgPath)
	return nil
}
```

**Step 2: Verify it builds**

Run: `go build -o bob .`
Run: `./bob login --help`
Expected: Help output

**Step 3: Commit**

```bash
git add cmd/login.go
git commit -m "feat: add bob login command with API key auth"
```

---

### Task 14: Add `bob init` command

**Files:**
- Create: `cmd/init.go`

**Step 1: Write the init command**

```go
package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/blder/bob/internal/config"
	"github.com/spf13/cobra"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Register current directory as a workspace",
	RunE:  runInit,
}

func init() {
	rootCmd.AddCommand(initCmd)
	initCmd.Flags().String("name", "", "workspace name (defaults to directory name)")
}

func runInit(cmd *cobra.Command, args []string) error {
	cfgPath, _ := cmd.Flags().GetString("config")
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath()
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if cfg.APIKey == "" {
		return fmt.Errorf("not authenticated. Run `bob login` first.")
	}

	workDir, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("get working directory: %w", err)
	}

	name, _ := cmd.Flags().GetString("name")
	if name == "" {
		name = filepath.Base(workDir)
	}

	slug := strings.ToLower(strings.ReplaceAll(name, " ", "-"))

	// For v0, we store workspace info locally.
	// The API registration (POST /workspaces) will be called when the backend is ready.
	cfg.WorkspaceID = slug

	if err := cfg.Save(cfgPath); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Printf("Workspace '%s' initialized in %s\n", name, workDir)
	fmt.Printf("Workspace ID: %s\n", slug)
	fmt.Println("\nNext: run `bob run <work-item-id>` to launch an agent")
	return nil
}
```

**Step 2: Verify it builds**

Run: `go build -o bob .`
Run: `./bob init --help`
Expected: Help output

**Step 3: Commit**

```bash
git add cmd/init.go
git commit -m "feat: add bob init command for workspace registration"
```

---

### Task 15: Add `bob status` command

**Files:**
- Create: `cmd/status.go`

**Step 1: Write the status command**

```go
package cmd

import (
	"fmt"

	"github.com/blder/bob/internal/api"
	"github.com/blder/bob/internal/config"
	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show workspace status and recent runs",
	RunE:  runStatus,
}

func init() {
	rootCmd.AddCommand(statusCmd)
}

func runStatus(cmd *cobra.Command, args []string) error {
	cfgPath, _ := cmd.Flags().GetString("config")
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath()
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if cfg.APIKey == "" {
		return fmt.Errorf("not authenticated. Run `bob login` first.")
	}
	if cfg.WorkspaceID == "" {
		return fmt.Errorf("no workspace. Run `bob init` first.")
	}

	fmt.Printf("Workspace: %s\n", cfg.WorkspaceID)
	fmt.Printf("API: %s\n", cfg.APIBaseURL)
	fmt.Printf("Default agent: %s\n", cfg.DefaultAgent)
	fmt.Printf("Agents configured: %d\n", len(cfg.Agents))

	for name, agent := range cfg.Agents {
		fmt.Printf("  - %s (%s)\n", name, agent.Command)
	}

	// Fetch recent runs from API
	client := api.New(cfg.APIBaseURL, cfg.APIKey)
	_ = client // Will be used when API is live

	fmt.Println("\n(Run history will show here once connected to blder.bot)")
	return nil
}
```

**Step 2: Verify it builds**

Run: `go build -o bob . && ./bob status --help`
Expected: Help output

**Step 3: Commit**

```bash
git add cmd/status.go
git commit -m "feat: add bob status command"
```

---

### Task 16: Add `bob agents` command

**Files:**
- Create: `cmd/agents.go`

**Step 1: Write the agents command**

```go
package cmd

import (
	"fmt"

	"github.com/blder/bob/internal/config"
	"github.com/spf13/cobra"
)

var agentsCmd = &cobra.Command{
	Use:   "agents",
	Short: "List and manage agent configurations",
	RunE:  runAgents,
}

func init() {
	rootCmd.AddCommand(agentsCmd)
}

func runAgents(cmd *cobra.Command, args []string) error {
	cfgPath, _ := cmd.Flags().GetString("config")
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath()
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if len(cfg.Agents) == 0 {
		fmt.Println("No agents configured.")
		fmt.Println("\nAdd agents to ~/.config/bob/config.yaml:")
		fmt.Println(`
agents:
  claude-code:
    command: claude
    args: ["--print", "--output-format", "stream-json"]
  smol-agent:
    command: smol
    first_class: true`)
		return nil
	}

	fmt.Printf("Agents (%d configured):\n\n", len(cfg.Agents))
	for name, agent := range cfg.Agents {
		defaultMark := ""
		if name == cfg.DefaultAgent {
			defaultMark = " (default)"
		}
		fmt.Printf("  %s%s\n", name, defaultMark)
		fmt.Printf("    command: %s\n", agent.Command)
		if len(agent.Args) > 0 {
			fmt.Printf("    args: %v\n", agent.Args)
		}
		if agent.FirstClass {
			fmt.Printf("    first-class: yes\n")
		}
		fmt.Println()
	}

	return nil
}
```

**Step 2: Verify it builds**

Run: `go build -o bob . && ./bob agents --help`
Expected: Help output

**Step 3: Commit**

```bash
git add cmd/agents.go
git commit -m "feat: add bob agents command"
```

---

### Task 17: End-to-end smoke test

**Files:**
- Create: `test/e2e_test.go`

**Step 1: Write the smoke test**

```go
package test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func buildBob(t *testing.T) string {
	t.Helper()
	binary := filepath.Join(t.TempDir(), "bob")
	cmd := exec.Command("go", "build", "-o", binary, ".")
	cmd.Dir = ".."
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build failed: %s\n%s", err, out)
	}
	return binary
}

func TestBob_HelpOutput(t *testing.T) {
	bob := buildBob(t)
	out, err := exec.Command(bob, "--help").CombinedOutput()
	if err != nil {
		t.Fatalf("help failed: %v", err)
	}
	if !strings.Contains(string(out), "blder.bot CLI") {
		t.Errorf("expected 'blder.bot CLI' in help output, got: %s", out)
	}
}

func TestBob_LoginWithKey(t *testing.T) {
	bob := buildBob(t)
	cfgDir := t.TempDir()
	cfgPath := filepath.Join(cfgDir, "config.yaml")

	cmd := exec.Command(bob, "login", "--api-key", "bob_test123", "--config", cfgPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("login failed: %v\n%s", err, out)
	}

	// Verify config was written
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "bob_test123") {
		t.Errorf("API key not saved in config")
	}
}

func TestBob_InitCreatesWorkspace(t *testing.T) {
	bob := buildBob(t)
	cfgDir := t.TempDir()
	cfgPath := filepath.Join(cfgDir, "config.yaml")

	// Login first
	exec.Command(bob, "login", "--api-key", "bob_test123", "--config", cfgPath).Run()

	// Init
	workDir := t.TempDir()
	cmd := exec.Command(bob, "init", "--config", cfgPath, "--name", "test-project")
	cmd.Dir = workDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("init failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "test-project") {
		t.Errorf("expected workspace name in output")
	}
}
```

**Step 2: Run the e2e tests**

Run: `cd ~/dev/bob-cli && go test ./test/ -v`
Expected: PASS

**Step 3: Commit**

```bash
git add test/
git commit -m "test: add e2e smoke tests for bob CLI"
```

---

## Summary

**Phase 0 (Tasks 1-6):** Multi-tenancy foundation in TypeScript monorepo
- Tasks 1-3: Schema changes (tenants, tenant_members, agent_runs, run_artifacts, workspace columns)
- Task 4: Seed tenant #1 + backfill
- Tasks 5-6: Public API router + API key generation

**Phase 1 (Tasks 7-17):** Go CLI binary
- Task 7: Go module scaffold with cobra
- Task 8: Config management (YAML)
- Task 9: API client
- Task 10: Agent launcher
- Task 11: Artifact collector
- Tasks 12-16: CLI commands (run, login, init, status, agents)
- Task 17: E2E smoke tests

**Total: 17 tasks, ~85 steps**

**After this plan:** The bob CLI can authenticate, register a workspace, launch any agent via YAML config, collect git diffs and logs, and report results to the Bob backend. The backend has multi-tenancy, agent runs, and artifact tracking. The vinext/Cloudflare migration and web UI updates are a separate Phase 2 plan.
