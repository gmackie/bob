# Repo Autodiscovery & ForgeGraph Onboarding — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Bob gateway daemon autodetects repos in a configurable directory, classifies them by ForgeGraph status, sends discovery data via heartbeat, and the API auto-creates projects for ForgeGraph-linked repos while surfacing others in a discovery UI.

**Architecture:** The gateway gets a new `repoScanner` module that walks `DEV_DIR` on each heartbeat tick. A `forgeDetector` module checks for `forge` CLI and caches app lists. The heartbeat REST endpoint and tRPC handler are extended to accept repo payloads. The API classifies repos and auto-creates projects. A new discovery API surfaces unlinked repos to the UI.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), tRPC, Next.js (blder app), `child_process.execSync` for git/forge CLI calls, Vitest for tests.

---

## Task 1: Schema Changes — Add Discovery Fields

**Files:**
- Modify: `packages/db/src/schema.ts:491-510` (workspaces table)
- Modify: `packages/db/src/schema.ts:606-627` (repositories table)
- Create: `packages/db/drizzle/0015_repo_autodiscovery.sql`

**Step 1: Write the migration SQL**

Create `packages/db/drizzle/0015_repo_autodiscovery.sql`:

```sql
-- Add discovery fields to workspaces
ALTER TABLE "workspaces" ADD COLUMN "forge_available" boolean DEFAULT false;
ALTER TABLE "workspaces" ADD COLUMN "forge_api_key" text;
ALTER TABLE "workspaces" ADD COLUMN "dev_dir" text;

-- Add discovery fields to repositories
ALTER TABLE "repositories" ADD COLUMN "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "repositories" ADD COLUMN "build_system" varchar(32);
ALTER TABLE "repositories" ADD COLUMN "dirty" boolean DEFAULT false;
ALTER TABLE "repositories" ADD COLUMN "stale" boolean DEFAULT false;
ALTER TABLE "repositories" ADD COLUMN "discovery_status" varchar(16) DEFAULT 'discovered';

-- Discovered non-git directories
CREATE TABLE "discovered_dirs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "name" varchar(256) NOT NULL,
  "dismissed" boolean DEFAULT false,
  "last_seen" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "discovered_dirs_workspace_path_idx" ON "discovered_dirs" ("workspace_id", "path");
CREATE INDEX "repositories_workspace_id_idx" ON "repositories" ("workspace_id");
```

**Step 2: Update Drizzle schema — workspaces table**

In `packages/db/src/schema.ts`, add to the `workspaces` table definition (after line 509, before the closing `})`):

```typescript
  forgeAvailable: t.boolean("forge_available").default(false),
  forgeApiKey: t.text("forge_api_key"),
  devDir: t.text("dev_dir"),
```

**Step 3: Update Drizzle schema — repositories table**

In `packages/db/src/schema.ts`, add to the `repositories` table definition (after line 623, before the closing `})`):

```typescript
  workspaceId: t.uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  buildSystem: t.varchar("build_system", { length: 32 }),
  dirty: t.boolean().default(false),
  stale: t.boolean().default(false),
  discoveryStatus: t.varchar("discovery_status", { length: 16 }).default("discovered"),
```

**Step 4: Add discoveredDirs table**

In `packages/db/src/schema.ts`, after the `repositories` table (after line 627):

```typescript
export const discoveredDirs = pgTable("discovered_dirs", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workspaceId: t
    .uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  path: t.text().notNull(),
  name: t.varchar({ length: 256 }).notNull(),
  dismissed: t.boolean().default(false),
  lastSeen: t.timestamp("last_seen", { mode: "string" }).defaultNow(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));
```

**Step 5: Export discoveredDirs from schema barrel**

Ensure `discoveredDirs` is exported from wherever the schema barrel file is (check `packages/db/src/index.ts` or equivalent).

**Step 6: Run migration to verify**

Run: `cd /Volumes/dev/bob && pnpm --filter @bob/db db:push` (or whatever the migration command is)
Expected: Migration applies cleanly.

**Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0015_repo_autodiscovery.sql
git commit -m "feat: add schema for repo autodiscovery (workspaces, repositories, discovered_dirs)"
```

---

## Task 2: Gateway — Forge Detector Module

**Files:**
- Create: `apps/gateway/src/discovery/forge-detector.ts`
- Create: `apps/gateway/src/discovery/__tests__/forge-detector.test.ts`

**Step 1: Write the failing test**

Create `apps/gateway/src/discovery/__tests__/forge-detector.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForgeDetector } from "../forge-detector.js";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
const mockExecSync = vi.mocked(execSync);

describe("ForgeDetector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects forge CLI when present", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();
    expect(detector.isAvailable()).toBe(true);
  });

  it("returns unavailable when forge CLI missing", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("command not found");
    });
    const detector = new ForgeDetector();
    expect(detector.isAvailable()).toBe(false);
  });

  it("checks auth status", () => {
    // forge available
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();

    // forge auth status returns success
    mockExecSync.mockReturnValueOnce(Buffer.from("authenticated as mackieg"));
    expect(detector.isAuthenticated()).toBe(true);
  });

  it("returns unauthenticated when forge auth fails", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();

    mockExecSync.mockImplementationOnce(() => {
      throw new Error("not authenticated");
    });
    expect(detector.isAuthenticated()).toBe(false);
  });

  it("lists forge apps", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();

    mockExecSync.mockReturnValueOnce(
      Buffer.from(JSON.stringify([
        { id: "abc", name: "bob", slug: "bob", flakeRef: "git+https://gitea.forge.gmac.io/mackieg/bob.git?ref=main" },
        { id: "def", name: "my-site", slug: "my-site", flakeRef: "git+https://gitea.forge.gmac.io/mackieg/my-site.git?ref=main" },
      ]))
    );

    const apps = detector.listApps();
    expect(apps).toHaveLength(2);
    expect(apps[0]!.name).toBe("bob");
  });

  it("extracts remote URL from flakeRef", () => {
    const detector = new ForgeDetector();
    const url = detector.extractRemoteUrl("git+https://gitea.forge.gmac.io/mackieg/bob.git?ref=main&rev=abc123");
    expect(url).toBe("https://gitea.forge.gmac.io/mackieg/bob.git");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Volumes/dev/bob && pnpm --filter @bob/gateway test -- src/discovery/__tests__/forge-detector.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `apps/gateway/src/discovery/forge-detector.ts`:

```typescript
import { execSync } from "child_process";

export interface ForgeApp {
  id: string;
  name: string;
  slug: string;
  flakeRef?: string;
}

const FORGE_CLI = process.env.FORGE_CLI_PATH ?? `${process.env.HOME}/.forgegraph/bin/fg`;

export class ForgeDetector {
  private available: boolean;
  private cachedApps: ForgeApp[] | null = null;

  constructor() {
    this.available = this.detectCli();
  }

  private detectCli(): boolean {
    try {
      execSync(`which ${FORGE_CLI}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  isAuthenticated(): boolean {
    if (!this.available) return false;
    try {
      execSync(`${FORGE_CLI} auth status`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  listApps(): ForgeApp[] {
    if (!this.available) return [];
    try {
      const output = execSync(`${FORGE_CLI} app list --json`, {
        stdio: "pipe",
        encoding: "utf8",
      });
      this.cachedApps = JSON.parse(output) as ForgeApp[];
      return this.cachedApps;
    } catch {
      return this.cachedApps ?? [];
    }
  }

  getCachedApps(): ForgeApp[] {
    return this.cachedApps ?? [];
  }

  extractRemoteUrl(flakeRef: string): string | null {
    const match = flakeRef.match(/git\+?(https?:\/\/[^?#]+)/);
    return match?.[1] ?? null;
  }

  /** Match a git remote URL against known forge apps */
  findAppByRemoteUrl(remoteUrl: string): ForgeApp | undefined {
    const apps = this.cachedApps ?? this.listApps();
    const normalized = remoteUrl.replace(/\.git$/, "").toLowerCase();
    return apps.find((app) => {
      if (!app.flakeRef) return false;
      const appUrl = this.extractRemoteUrl(app.flakeRef);
      if (!appUrl) return false;
      return appUrl.replace(/\.git$/, "").toLowerCase() === normalized;
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Volumes/dev/bob && pnpm --filter @bob/gateway test -- src/discovery/__tests__/forge-detector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/gateway/src/discovery/
git commit -m "feat: add ForgeDetector module for forge CLI detection and app listing"
```

---

## Task 3: Gateway — Repo Scanner Module

**Files:**
- Create: `apps/gateway/src/discovery/repo-scanner.ts`
- Create: `apps/gateway/src/discovery/__tests__/repo-scanner.test.ts`

**Step 1: Write the failing test**

Create `apps/gateway/src/discovery/__tests__/repo-scanner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RepoScanner, DiscoveredRepo } from "../repo-scanner.js";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);

describe("RepoScanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scans top-level directories and classifies git repos", () => {
    mockReaddirSync.mockReturnValue(["bob", "my-site", "notes"] as any);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

    // bob has .git, my-site has .git, notes does not
    mockExistsSync.mockImplementation((path: any) => {
      if (path === "/dev/bob/.git") return true;
      if (path === "/dev/my-site/.git") return true;
      if (path === "/dev/notes/.git") return false;
      // build system checks
      if (path === "/dev/bob/package.json") return true;
      if (path === "/dev/my-site/go.mod") return true;
      return false;
    });

    // git remote get-url origin
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.includes("/dev/bob")) {
        return Buffer.from("https://gitea.forge.gmac.io/mackieg/bob.git\n");
      }
      if (typeof cmd === "string" && cmd.includes("/dev/my-site")) {
        return Buffer.from("https://gitea.forge.gmac.io/mackieg/my-site.git\n");
      }
      if (typeof cmd === "string" && cmd.includes("git -C") && cmd.includes("branch --show-current")) {
        return Buffer.from("main\n");
      }
      if (typeof cmd === "string" && cmd.includes("status --porcelain")) {
        return Buffer.from("");
      }
      return Buffer.from("");
    });

    const scanner = new RepoScanner("/dev");
    const results = scanner.scan();

    expect(results).toHaveLength(3);

    const bob = results.find((r) => r.name === "bob")!;
    expect(bob.isGit).toBe(true);
    expect(bob.remoteUrl).toContain("bob.git");
    expect(bob.buildSystem).toBe("node");

    const notes = results.find((r) => r.name === "notes")!;
    expect(notes.isGit).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Volumes/dev/bob && pnpm --filter @bob/gateway test -- src/discovery/__tests__/repo-scanner.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `apps/gateway/src/discovery/repo-scanner.ts`:

```typescript
import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";

export interface DiscoveredRepo {
  name: string;
  path: string;
  isGit: boolean;
  remoteUrl?: string;
  branch?: string;
  dirty?: boolean;
  buildSystem?: string;
  forgeAppId?: string;
}

function detectBuildSystem(dirPath: string): string | undefined {
  if (existsSync(join(dirPath, "package.json"))) return "node";
  if (existsSync(join(dirPath, "go.mod"))) return "go";
  if (existsSync(join(dirPath, "Cargo.toml"))) return "rust";
  if (existsSync(join(dirPath, "Makefile"))) return "make";
  if (existsSync(join(dirPath, "pyproject.toml")) || existsSync(join(dirPath, "setup.py"))) return "python";
  if (existsSync(join(dirPath, "flake.nix"))) return "nix";
  return undefined;
}

function gitExec(repoPath: string, args: string): string | undefined {
  try {
    return execSync(`git -C "${repoPath}" ${args}`, {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return undefined;
  }
}

export class RepoScanner {
  constructor(private devDir: string) {}

  scan(): DiscoveredRepo[] {
    if (!existsSync(this.devDir)) {
      console.warn(`[RepoScanner] DEV_DIR does not exist: ${this.devDir}`);
      return [];
    }

    const entries = readdirSync(this.devDir);
    const results: DiscoveredRepo[] = [];

    for (const entry of entries) {
      // Skip hidden directories
      if (entry.startsWith(".")) continue;

      const fullPath = join(this.devDir, entry);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const isGit = existsSync(join(fullPath, ".git"));

      if (!isGit) {
        results.push({ name: entry, path: fullPath, isGit: false });
        continue;
      }

      const remoteUrl = gitExec(fullPath, "remote get-url origin");
      const branch = gitExec(fullPath, "branch --show-current");
      const porcelain = gitExec(fullPath, "status --porcelain");
      const dirty = porcelain !== undefined && porcelain.length > 0;
      const buildSystem = detectBuildSystem(fullPath);

      results.push({
        name: entry,
        path: fullPath,
        isGit: true,
        remoteUrl: remoteUrl || undefined,
        branch: branch || undefined,
        dirty,
        buildSystem,
      });
    }

    return results;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Volumes/dev/bob && pnpm --filter @bob/gateway test -- src/discovery/__tests__/repo-scanner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/gateway/src/discovery/repo-scanner.ts apps/gateway/src/discovery/__tests__/repo-scanner.test.ts
git commit -m "feat: add RepoScanner module for directory-based repo discovery"
```

---

## Task 4: Gateway — Heartbeat Sender

**Files:**
- Create: `apps/gateway/src/discovery/heartbeat-sender.ts`
- Create: `apps/gateway/src/discovery/__tests__/heartbeat-sender.test.ts`

**Step 1: Write the failing test**

Create `apps/gateway/src/discovery/__tests__/heartbeat-sender.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HeartbeatSender } from "../heartbeat-sender.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("HeartbeatSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });

  it("sends heartbeat with agent types and repos", async () => {
    const sender = new HeartbeatSender({
      apiUrl: "http://localhost:3000",
      apiKey: "bob_test123",
      workspaceId: "ws-123",
    });

    await sender.send({
      agentTypes: ["claude"],
      forgeAvailable: true,
      repos: [
        {
          name: "bob",
          path: "/dev/bob",
          isGit: true,
          remoteUrl: "https://gitea.forge.gmac.io/mackieg/bob.git",
          branch: "main",
          dirty: false,
          buildSystem: "node",
          forgeAppId: "abc123",
        },
      ],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/api/v1/workspaces/ws-123/heartbeat");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.agentTypes).toEqual(["claude"]);
    expect(body.repos).toHaveLength(1);
    expect(body.forgeAvailable).toBe(true);
  });

  it("handles API errors without throwing", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("Internal error") });

    const sender = new HeartbeatSender({
      apiUrl: "http://localhost:3000",
      apiKey: "bob_test123",
      workspaceId: "ws-123",
    });

    // Should not throw
    await sender.send({ agentTypes: [], forgeAvailable: false, repos: [] });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Volumes/dev/bob && pnpm --filter @bob/gateway test -- src/discovery/__tests__/heartbeat-sender.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `apps/gateway/src/discovery/heartbeat-sender.ts`:

```typescript
import { DiscoveredRepo } from "./repo-scanner.js";

export interface HeartbeatPayload {
  agentTypes: string[];
  forgeAvailable: boolean;
  repos: DiscoveredRepo[];
}

interface HeartbeatConfig {
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
}

export class HeartbeatSender {
  constructor(private config: HeartbeatConfig) {}

  async send(payload: HeartbeatPayload): Promise<void> {
    const url = `${this.config.apiUrl}/api/v1/workspaces/${this.config.workspaceId}/heartbeat`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[HeartbeatSender] API returned ${res.status}: ${text}`);
      }
    } catch (err) {
      console.warn(`[HeartbeatSender] Failed to send heartbeat:`, err);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Volumes/dev/bob && pnpm --filter @bob/gateway test -- src/discovery/__tests__/heartbeat-sender.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/gateway/src/discovery/heartbeat-sender.ts apps/gateway/src/discovery/__tests__/heartbeat-sender.test.ts
git commit -m "feat: add HeartbeatSender for outbound heartbeat with repo payload"
```

---

## Task 5: Gateway — Discovery Loop Integration

**Files:**
- Create: `apps/gateway/src/discovery/discovery-loop.ts`
- Modify: `apps/gateway/src/index.ts:1921-1939` (startup)

**Step 1: Write the discovery loop**

Create `apps/gateway/src/discovery/discovery-loop.ts`:

```typescript
import { ForgeDetector } from "./forge-detector.js";
import { RepoScanner, DiscoveredRepo } from "./repo-scanner.js";
import { HeartbeatSender, HeartbeatPayload } from "./heartbeat-sender.js";

export interface DiscoveryNotice {
  type: "forge_not_detected" | "forge_not_authenticated" | "dev_dir_missing";
  message: string;
  dismissable: boolean;
}

export interface DiscoveryState {
  forgeAvailable: boolean;
  forgeAuthenticated: boolean;
  repos: DiscoveredRepo[];
  notices: DiscoveryNotice[];
}

interface DiscoveryLoopConfig {
  devDir: string;
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
  agentTypes: string[];
  intervalMs?: number;
}

export class DiscoveryLoop {
  private forgeDetector: ForgeDetector;
  private repoScanner: RepoScanner;
  private heartbeatSender: HeartbeatSender;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: DiscoveryState;

  constructor(private config: DiscoveryLoopConfig) {
    this.forgeDetector = new ForgeDetector();
    this.repoScanner = new RepoScanner(config.devDir);
    this.heartbeatSender = new HeartbeatSender({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      workspaceId: config.workspaceId,
    });
    this.state = {
      forgeAvailable: false,
      forgeAuthenticated: false,
      repos: [],
      notices: [],
    };
  }

  async start(): Promise<DiscoveryState> {
    // Initial detection
    const notices: DiscoveryNotice[] = [];

    if (!this.forgeDetector.isAvailable()) {
      notices.push({
        type: "forge_not_detected",
        message: "ForgeGraph CLI not detected. Some features (app registration, build pipelines) are unavailable. Install forge CLI to enable full functionality.",
        dismissable: true,
      });
    } else if (!this.forgeDetector.isAuthenticated()) {
      notices.push({
        type: "forge_not_authenticated",
        message: "ForgeGraph CLI found but not authenticated. Run 'forge auth login' to enable ForgeGraph features.",
        dismissable: true,
      });
    } else {
      // Authenticated — cache app list
      this.forgeDetector.listApps();
    }

    this.state.forgeAvailable = this.forgeDetector.isAvailable();
    this.state.forgeAuthenticated = this.forgeDetector.isAuthenticated();
    this.state.notices = notices;

    // Initial scan + heartbeat
    await this.tick();

    // Start the loop
    const interval = this.config.intervalMs ?? 30_000;
    this.timer = setInterval(() => this.tick(), interval);

    console.log(`[DiscoveryLoop] Started (interval: ${interval}ms, devDir: ${this.config.devDir}, forge: ${this.state.forgeAvailable ? "yes" : "no"})`);
    return this.state;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getState(): DiscoveryState {
    return this.state;
  }

  private async tick(): Promise<void> {
    // Scan repos
    const repos = this.repoScanner.scan();

    // Enrich with forge app IDs if forge is available
    if (this.state.forgeAvailable && this.state.forgeAuthenticated) {
      // Refresh app list periodically (listApps caches internally)
      this.forgeDetector.listApps();

      for (const repo of repos) {
        if (repo.isGit && repo.remoteUrl) {
          const app = this.forgeDetector.findAppByRemoteUrl(repo.remoteUrl);
          if (app) {
            repo.forgeAppId = app.id;
          }
        }
      }
    }

    this.state.repos = repos;

    // Send heartbeat
    await this.heartbeatSender.send({
      agentTypes: this.config.agentTypes,
      forgeAvailable: this.state.forgeAvailable,
      repos,
    });
  }
}
```

**Step 2: Integrate into gateway startup**

In `apps/gateway/src/index.ts`, add to the top with other imports:

```typescript
import { DiscoveryLoop } from "./discovery/discovery-loop.js";
```

Add after the existing constants (line ~47):

```typescript
const DEV_DIR = process.env.DEV_DIR;
const BOB_WORKSPACE_ID = process.env.BOB_WORKSPACE_ID;
```

In the `server.listen` callback (line 1921), add after the forge runner starts:

```typescript
  // Start repo autodiscovery loop
  if (DEV_DIR && BOB_WORKSPACE_ID && process.env.BOB_API_KEY) {
    const discoveryLoop = new DiscoveryLoop({
      devDir: DEV_DIR,
      apiUrl: process.env.BOB_API_URL ?? "http://localhost:3000",
      apiKey: process.env.BOB_API_KEY,
      workspaceId: BOB_WORKSPACE_ID,
      agentTypes: (process.env.AGENT_TYPES ?? "claude").split(","),
    });
    discoveryLoop.start().then((state) => {
      console.log(`[Gateway] Discovery: ${state.repos.length} repos found, forge: ${state.forgeAvailable}`);
      for (const notice of state.notices) {
        console.warn(`[Gateway] Notice: ${notice.message}`);
      }
    }).catch((err) => {
      console.warn("[Gateway] Discovery loop failed to start:", err);
    });
  } else if (DEV_DIR) {
    console.warn("[Gateway] DEV_DIR set but missing BOB_WORKSPACE_ID or BOB_API_KEY — discovery disabled");
  }
```

**Step 3: Commit**

```bash
git add apps/gateway/src/discovery/discovery-loop.ts apps/gateway/src/index.ts
git commit -m "feat: integrate discovery loop into gateway startup"
```

---

## Task 6: API — Expand Heartbeat to Process Repos

**Files:**
- Modify: `apps/blder/src/app/api/v1/workspaces/[workspaceId]/heartbeat/route.ts`
- Modify: `packages/api/src/router/publicApi.ts:308-345`

**Step 1: Update the REST route to pass new fields**

In `apps/blder/src/app/api/v1/workspaces/[workspaceId]/heartbeat/route.ts`, update the caller invocation:

```typescript
import { NextResponse } from "next/server";
import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const body = await request.json().catch(() => ({}));
    const caller = await createPublicApiCaller(request);
    const result = await caller.publicApi.heartbeat({
      workspaceId,
      agentTypes: Array.isArray(body.agentTypes) ? body.agentTypes : undefined,
      forgeAvailable: typeof body.forgeAvailable === "boolean" ? body.forgeAvailable : undefined,
      repos: Array.isArray(body.repos) ? body.repos : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
```

**Step 2: Expand tRPC heartbeat handler**

In `packages/api/src/router/publicApi.ts`, update the heartbeat procedure input and handler:

```typescript
  // POST /workspaces/:id/heartbeat
  heartbeat: apiKeyWriteProcedure
    .input(z.object({
      workspaceId: z.string().uuid(),
      agentTypes: z.array(z.string()).optional(),
      forgeAvailable: z.boolean().optional(),
      repos: z.array(z.object({
        name: z.string(),
        path: z.string(),
        isGit: z.boolean(),
        remoteUrl: z.string().optional(),
        branch: z.string().optional(),
        dirty: z.boolean().optional(),
        buildSystem: z.string().optional(),
        forgeAppId: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!workspace?.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertTenantAccess(ctx.db, ctx.session.user.id, workspace.tenantId);

      const updates: Record<string, unknown> = {
        lastHeartbeat: new Date().toISOString(),
      };

      if (input.agentTypes && input.agentTypes.length > 0) {
        const agentConfigs: Record<string, unknown> = {};
        for (const agent of input.agentTypes) {
          agentConfigs[agent] = { available: true };
        }
        updates.agentConfigs = agentConfigs;
      }

      if (input.forgeAvailable !== undefined) {
        updates.forgeAvailable = input.forgeAvailable;
      }

      await ctx.db
        .update(workspaces)
        .set(updates)
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.tenantId, workspace.tenantId),
          ),
        );

      // Process discovered repos
      if (input.repos && input.repos.length > 0) {
        await processDiscoveredRepos(ctx.db, ctx.session.user.id, input.workspaceId, workspace.tenantId, input.repos);
      }

      return { ok: true };
    }),
```

**Step 3: Write the processDiscoveredRepos function**

Add above the router export in `packages/api/src/router/publicApi.ts`:

```typescript
import { projects, repositories, discoveredDirs, activities } from "@bob/db/schema";

async function processDiscoveredRepos(
  db: any,
  userId: string,
  workspaceId: string,
  tenantId: string,
  repos: Array<{
    name: string;
    path: string;
    isGit: boolean;
    remoteUrl?: string;
    branch?: string;
    dirty?: boolean;
    buildSystem?: string;
    forgeAppId?: string;
  }>,
) {
  const gitRepos = repos.filter((r) => r.isGit);
  const nonGitDirs = repos.filter((r) => !r.isGit);

  // Mark all existing repos for this workspace as stale, then un-stale the ones we see
  await db
    .update(repositories)
    .set({ stale: true })
    .where(eq(repositories.workspaceId, workspaceId));

  for (const repo of gitRepos) {
    // Upsert repository record
    const existing = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.workspaceId, workspaceId),
        eq(repositories.path, repo.path),
      ),
    });

    if (existing) {
      await db
        .update(repositories)
        .set({
          remoteUrl: repo.remoteUrl ?? existing.remoteUrl,
          branch: repo.branch ?? existing.branch,
          dirty: repo.dirty ?? false,
          buildSystem: repo.buildSystem ?? existing.buildSystem,
          stale: false,
        })
        .where(eq(repositories.id, existing.id));
    } else {
      await db.insert(repositories).values({
        userId,
        workspaceId,
        name: repo.name,
        path: repo.path,
        branch: repo.branch ?? "main",
        mainBranch: repo.branch ?? "main",
        remoteUrl: repo.remoteUrl,
        buildSystem: repo.buildSystem,
        dirty: repo.dirty ?? false,
        stale: false,
        discoveryStatus: "discovered",
      });
    }

    // Auto-create project for ForgeGraph-linked repos
    if (repo.forgeAppId) {
      const existingProject = await db.query.projects.findFirst({
        where: and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.forgeGraphAppId, repo.forgeAppId),
        ),
      });

      if (!existingProject) {
        // Generate a key from the repo name (uppercase, alphanumeric, max 16)
        const key = repo.name
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 16) || "PROJ";

        // Check for key conflicts
        const keyConflict = await db.query.projects.findFirst({
          where: and(
            eq(projects.workspaceId, workspaceId),
            eq(projects.key, key),
          ),
        });

        if (!keyConflict) {
          const [newProject] = await db
            .insert(projects)
            .values({
              workspaceId,
              forgeGraphAppId: repo.forgeAppId,
              name: repo.name,
              key,
              repoUrl: repo.remoteUrl,
              status: "active",
            })
            .returning();

          // Link the repository to the project
          if (newProject) {
            await db
              .update(repositories)
              .set({ planningProjectId: newProject.id })
              .where(
                and(
                  eq(repositories.workspaceId, workspaceId),
                  eq(repositories.path, repo.path),
                ),
              );
          }
        }
      }
    }
  }

  // Upsert non-git directories
  for (const dir of nonGitDirs) {
    await db
      .insert(discoveredDirs)
      .values({
        workspaceId,
        path: dir.path,
        name: dir.name,
        lastSeen: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [discoveredDirs.workspaceId, discoveredDirs.path],
        set: { lastSeen: new Date().toISOString() },
      });
  }
}
```

**Step 4: Commit**

```bash
git add apps/blder/src/app/api/v1/workspaces/\[workspaceId\]/heartbeat/route.ts packages/api/src/router/publicApi.ts
git commit -m "feat: expand heartbeat to process discovered repos and auto-create projects"
```

---

## Task 7: API — Discovery Query Endpoints

**Files:**
- Modify: `packages/api/src/router/project.ts` (add discovery query)

**Step 1: Add a discovery endpoint to project router**

Add to `packages/api/src/router/project.ts`:

```typescript
  discovery: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx.db, ctx.session.user.id, input.workspaceId);

      // Get all repos for this workspace
      const allRepos = await ctx.db.query.repositories.findMany({
        where: and(
          eq(repositories.workspaceId, input.workspaceId),
          eq(repositories.stale, false),
        ),
      });

      // Get all projects for this workspace
      const allProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.workspaceId, input.workspaceId),
      });

      // Get non-git directories
      const nonGitDirs = await ctx.db.query.discoveredDirs.findMany({
        where: and(
          eq(discoveredDirs.workspaceId, input.workspaceId),
          eq(discoveredDirs.dismissed, false),
        ),
      });

      // Get workspace for forge status
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });

      // Classify repos
      const linked: typeof allRepos = []; // green
      const forgeReady: typeof allRepos = []; // blue
      const gitOnly: typeof allRepos = []; // yellow

      for (const repo of allRepos) {
        const project = allProjects.find(
          (p) => p.id === repo.planningProjectId ||
            (p.forgeGraphAppId && p.repoUrl && repo.remoteUrl &&
              p.repoUrl.replace(/\.git$/, "") === repo.remoteUrl.replace(/\.git$/, ""))
        );

        if (project) {
          linked.push(repo);
        } else if (repo.discoveryStatus === "discovered") {
          gitOnly.push(repo);
        } else {
          forgeReady.push(repo);
        }
      }

      return {
        forgeAvailable: workspace?.forgeAvailable ?? false,
        linked: linked.map((r) => ({
          ...r,
          project: allProjects.find((p) => p.id === r.planningProjectId),
        })),
        forgeReady,
        gitOnly,
        nonGit: nonGitDirs,
      };
    }),

  dismissDir: protectedProcedure
    .input(z.object({ dirId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(discoveredDirs)
        .set({ dismissed: true })
        .where(eq(discoveredDirs.id, input.dirId));
      return { ok: true };
    }),
```

Add the necessary imports at the top of the file:

```typescript
import { discoveredDirs, workspaces } from "@bob/db/schema";
```

**Step 2: Commit**

```bash
git add packages/api/src/router/project.ts
git commit -m "feat: add discovery query and dismissDir endpoints"
```

---

## Task 8: Gateway — Forge Registration Endpoint

**Files:**
- Modify: `apps/gateway/src/index.ts` (add HTTP endpoint)

**Step 1: Add a POST /forge/register endpoint**

In `apps/gateway/src/index.ts`, in the HTTP request handler (find the existing route handling section), add:

```typescript
  // POST /forge/register — trigger forge app create for a repo path
  if (req.method === "POST" && pathname === "/forge/register") {
    let body: { path: string };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    try {
      const { ForgeDetector } = await import("./discovery/forge-detector.js");
      const detector = new ForgeDetector();

      if (!detector.isAvailable()) {
        sendJson(res, 503, { error: "ForgeGraph CLI not available" });
        return;
      }
      if (!detector.isAuthenticated()) {
        sendJson(res, 401, { error: "ForgeGraph CLI not authenticated" });
        return;
      }

      const { execSync } = await import("child_process");
      const result = execSync(
        `${process.env.FORGE_CLI_PATH ?? "${process.env.HOME}/.forgegraph/bin/fg"} app create --path "${body.path}" --json`,
        { stdio: "pipe", encoding: "utf8", timeout: 30000 }
      );

      const app = JSON.parse(result);
      sendJson(res, 200, { ok: true, app });
    } catch (err) {
      sendJson(res, 500, { error: `Failed to register: ${err}` });
    }
    return;
  }
```

**Step 2: Commit**

```bash
git add apps/gateway/src/index.ts
git commit -m "feat: add POST /forge/register endpoint for forge app creation"
```

---

## Task 9: UI — Projects Discovery Page

**Files:**
- Modify or create: `apps/blder/src/app/(dashboard)/projects/page.tsx` (or equivalent projects page)

This task covers the UI for displaying discovered repos grouped by status with action buttons. The exact file paths depend on the current blder app routing structure.

**Step 1: Check current projects page location**

Look for existing projects page in `apps/blder/src/app/` directory structure.

**Step 2: Build the discovery dashboard component**

The page should:
- Call `trpc.project.discovery.useQuery({ workspaceId })` to get classified repos
- Render four sections: Active Projects (green), Ready to Onboard (blue), Discovered Repos (yellow), Warnings (red)
- Show a dismissable banner for forge notices (from workspace `forgeAvailable` field)
- "Register with ForgeGraph" button calls `POST /forge/register` via the gateway
- "Ignore" button calls `trpc.project.dismissDir.useMutation()`

**Step 3: Wire up the register action**

The register button should:
1. POST to gateway `/forge/register` with the repo path
2. On success, show a toast notification
3. The next heartbeat will pick up the new forge app and auto-create the project

**Step 4: Commit**

```bash
git add apps/blder/src/app/
git commit -m "feat: add projects discovery dashboard with repo classification UI"
```

---

## Task 10: Deploy Configuration — Labnuc Env Vars

**Files:**
- Modify: `deploy/` or `.env.example` (add new env vars documentation)

**Step 1: Document the new env vars needed on labnuc**

The gateway on labnuc needs these new env vars added to its systemd service or `.env`:

```bash
# Repo autodiscovery
DEV_DIR=/home/mackieg/dev
BOB_WORKSPACE_ID=<workspace-uuid>
AGENT_TYPES=claude,codex

# Already required:
BOB_API_URL=https://bob.tail1e1a32.ts.net
BOB_API_KEY=bob_<existing-key>

# Optional:
FORGE_CLI_PATH=/home/mackieg/.forgegraph/bin/fg
```

**Step 2: Commit**

```bash
git add deploy/
git commit -m "docs: add env vars for repo autodiscovery on labnuc"
```

---

## Summary of Changes

| Component | What Changes |
|-----------|-------------|
| `packages/db` | New migration: workspace fields, repo fields, `discovered_dirs` table |
| `apps/gateway/src/discovery/` | New modules: `forge-detector.ts`, `repo-scanner.ts`, `heartbeat-sender.ts`, `discovery-loop.ts` |
| `apps/gateway/src/index.ts` | Start discovery loop on boot, add `/forge/register` endpoint |
| `packages/api/src/router/publicApi.ts` | Expand heartbeat to accept repos, process discovery |
| `packages/api/src/router/project.ts` | Add `discovery` query and `dismissDir` mutation |
| `apps/blder/src/app/.../heartbeat/route.ts` | Pass new fields through to tRPC |
| `apps/blder/src/app/.../projects/` | Discovery dashboard UI |
