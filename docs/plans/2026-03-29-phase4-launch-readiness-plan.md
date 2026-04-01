# Phase 4: Launch Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make blder.bot self-service — new users sign up, get a tenant automatically, see onboarding instructions, generate an API key, and start using bob CLI without any manual intervention.

**Architecture:** Auto-provisioning on first authenticated request. The publicApi router checks if the user has a tenant and creates one if not. The dashboard detects empty state and shows onboarding. Settings page already handles API key generation.

**Tech Stack:** tRPC middleware, existing Better Auth, Drizzle

---

### Task 1: Auto-create tenant on first authenticated request

**Files:**
- Modify: `packages/api/src/router/publicApi.ts`

Add a helper that checks if the current user has a tenant membership, and creates one if not. Call this from registerWorkspace and createRun.

**Step 1: Add ensureTenant helper**

Add at the top of publicApi.ts (before the router export):

```typescript
async function ensureTenant(db: any, userId: string) {
  // Check if user already has a tenant
  let membership = await db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, userId),
    with: { tenant: true },
  });

  if (membership) return membership;

  // Auto-create tenant for new user
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: userId,
      slug: userId.replace(/[^a-z0-9-]/g, "-").slice(0, 64),
      plan: "free",
    })
    .returning();

  await db.insert(tenantMembers).values({
    tenantId: tenant.id,
    userId,
    role: "owner",
  });

  membership = await db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, userId),
    with: { tenant: true },
  });

  return membership;
}
```

**Step 2: Update registerWorkspace to use ensureTenant**

Replace the existing tenant lookup in registerWorkspace:
```typescript
const membership = await ensureTenant(ctx.db, ctx.session.user.id);
```

**Step 3: Commit**

```bash
git commit -m "feat: auto-create tenant on first authenticated request"
```

---

### Task 2: Add onboarding empty state to runs page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/runs/page.tsx`

**Step 1: Update the empty state**

Replace the simple "No runs yet" empty state with the onboarding checklist from the design doc:

```tsx
<Card className="p-8">
  <h3 className="font-display text-lg font-semibold">
    Welcome to blder.bot
  </h3>
  <p className="text-muted-foreground mt-2 text-sm">
    See what your agents did, understand the changes, and ship with confidence.
  </p>
  <div className="mt-6 space-y-4">
    <div className="flex items-start gap-3">
      <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
        1
      </span>
      <div>
        <p className="text-sm font-medium">Install bob</p>
        <code className="bg-muted mt-1 block rounded px-3 py-2 font-mono text-xs">
          brew install blder/tap/bob
        </code>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
        2
      </span>
      <div>
        <p className="text-sm font-medium">Generate an API key</p>
        <p className="text-muted-foreground text-xs">
          Go to{" "}
          <Link href="/settings" className="text-primary hover:underline">
            Settings → API Keys
          </Link>{" "}
          and create a key for the CLI.
        </p>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
        3
      </span>
      <div>
        <p className="text-sm font-medium">Authenticate</p>
        <code className="bg-muted mt-1 block rounded px-3 py-2 font-mono text-xs">
          bob login --api-key YOUR_KEY
        </code>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
        4
      </span>
      <div>
        <p className="text-sm font-medium">Initialize a workspace</p>
        <code className="bg-muted mt-1 block rounded px-3 py-2 font-mono text-xs">
          cd your-project && bob init
        </code>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
        5
      </span>
      <div>
        <p className="text-sm font-medium">Run your first agent</p>
        <code className="bg-muted mt-1 block rounded px-3 py-2 font-mono text-xs">
          bob run &lt;work-item-id&gt; --agent claude-code
        </code>
      </div>
    </div>
  </div>
</Card>
```

**Step 2: Commit**

```bash
git commit -m "feat: add onboarding checklist to runs empty state"
```

---

### Task 3: Make /runs the default landing page

**Files:**
- Modify: `apps/web/src/middleware.ts`

**Step 1: Change the redirect**

The middleware currently redirects `/` to `/planning`. Change it to `/runs`:

```typescript
target.pathname = "/runs";
```

This makes the agent runs page the first thing a user sees — aligned with the "observability and trust" value prop.

**Step 2: Commit**

```bash
git commit -m "feat: make /runs the default landing page"
```

---

### Task 4: Deploy and verify end-to-end new user flow

Deploy to labnuc and walk through the flow as if you were a new user:
1. Sign in via GitHub OAuth
2. Land on /runs (empty state with onboarding checklist)
3. Go to Settings → API Keys → create a key
4. Use bob CLI: login, init, run
5. See the run appear on the /runs page

---

## Summary

**4 tasks:**
1. Auto-create tenant on first auth (no manual SQL needed)
2. Onboarding checklist on empty /runs page
3. /runs as default landing page
4. Deploy and verify

**After this plan:** A new user can sign up, follow the onboarding instructions, and start using blder.bot with zero manual intervention. This is the minimum for a self-service product.
