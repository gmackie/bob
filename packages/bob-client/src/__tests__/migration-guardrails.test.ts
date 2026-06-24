import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

const trackedFiles = (command: string): string[] => {
  return execFileSync("git", command.split(" "), {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
};

const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

describe("Bob Effect-RPC migration guardrails", () => {
  it("@gmacko/bob-client stays browser-safe", () => {
    const files = trackedFiles("ls-files packages/bob-client/src");
    const forbidden = [
      "@bob/api",
      "@bob/db",
      "@bob/auth",
      "server-only",
      "node:fs",
      "node:child_process",
    ];

    const violations = files.flatMap((file) => {
      if (file.includes("__tests__")) return [];
      const text = read(file);
      return forbidden
        .filter((token) => text.includes(token))
        .map((token) => `${relative(repoRoot, join(repoRoot, file))}: ${token}`);
    });

    expect(violations).toEqual([]);
  });

  it("does not add unallowlisted Bob-owned /api/trpc production fetches", () => {
    const files = trackedFiles("ls-files apps/bob apps/mobile-bob packages/bob packages/bob-client");
    const allowed = new Set([
      "apps/bob/src/app/api/trpc/[trpc]/route.ts",
      "apps/bob/src/lib/edge-router.ts",
      "apps/bob/src/trpc/react.tsx",
      "apps/bob/src/trpc/server.tsx",
      "apps/bob/src/server/planning/sync-repos.ts",
      "apps/bob/src/server/rpc.ts",
      "apps/mobile-bob/src/utils/api.tsx",
      "apps/mobile-bob/src/features/chat/hooks/use-ooda-chat.ts",
      "apps/mobile-bob/src/features/chat/hooks/use-oracle-search.ts",
      "apps/mobile-bob/src/features/chat/hooks/use-vault-browser.ts",
      "apps/mobile-bob/src/features/chat/slash-commands.ts",
      "packages/bob/src/cookies/src/cli.ts",
      "packages/bob-client/src/__tests__/migration-guardrails.test.ts",
    ]);

    const violations = files.filter((file) => {
      if (allowed.has(file)) return false;
      if (file.includes("__tests__")) return false;
      return read(file).includes("/api/trpc");
    });

    expect(violations).toEqual([]);
  });

  it("keeps the first migrated web slices off the tRPC React client", () => {
    const migratedSlices = [
      "apps/bob/src/app/(dashboard)/planning/page.tsx",
      "apps/bob/src/app/(dashboard)/planning/layout.tsx",
      "apps/bob/src/app/(dashboard)/tasks/page.tsx",
      "apps/bob/src/components/notifications/notification-panel.tsx",
      "apps/bob/src/app/(dashboard)/_shell.tsx",
      "apps/bob/src/components/work-items/lifecycle-timeline.tsx",
      "apps/bob/src/components/work-items/activity-timeline.tsx",
      "apps/bob/src/components/work-items/agent-runs-panel.tsx",
      "apps/bob/src/components/work-items/forge-graph-section.tsx",
      "apps/bob/src/hooks/use-live-build-status.ts",
      "apps/bob/src/components/planning/planning-dashboard.tsx",
      "apps/bob/src/components/planning/recent-plans.tsx",
      "apps/bob/src/components/planning/active-dispatch-bar.tsx",
      "apps/bob/src/components/planning/dispatch-plan.tsx",
      "apps/bob/src/app/(dashboard)/settings/_components/cookie-jar.tsx",
      "apps/bob/src/app/(dashboard)/settings/_components/api-keys.tsx",
      "apps/bob/src/app/(dashboard)/settings/_components/git-providers.tsx",
      "apps/bob/src/app/(dashboard)/settings/_components/webhooks.tsx",
      "apps/bob/src/app/(dashboard)/settings/_components/preferences.tsx",
      "apps/bob/src/app/(dashboard)/settings/_components/integrations.tsx",
      "apps/bob/src/app/(dashboard)/settings/_components/workspace-agents.tsx",
      "apps/bob/src/app/(dashboard)/pull-requests/page.tsx",
      "apps/bob/src/app/(dashboard)/pull-requests/[prId]/page.tsx",
      "apps/bob/src/components/pull-requests/pr-list.tsx",
      "apps/bob/src/components/pull-requests/pr-review-section.tsx",
      "apps/bob/src/components/dashboard/work-pipeline.tsx",
      "apps/bob/src/components/dashboard/work-lane-table.tsx",
      "apps/bob/src/components/dashboard/project-progress.tsx",
      "apps/bob/src/components/dashboard/recent-runs.tsx",
      "apps/bob/src/components/dashboard/active-dispatches.tsx",
      "apps/bob/src/components/dashboard/provider-capacity-cards.tsx",
      "apps/bob/src/components/dashboard/running-now-rail.tsx",
    ];

    const violations = migratedSlices.filter((file) =>
      read(file).includes("~/trpc/react"),
    );

    expect(violations).toEqual([]);
  });
});
