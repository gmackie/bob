import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
);

const sourceFiles = (paths: string[], cwd = repoRoot): string[] => {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...paths,
    ],
    {
      cwd,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
  return [...new Set(files)].filter(
    (file) => /\.[cm]?[jt]sx?$/.test(file) && existsSync(join(cwd, file)),
  );
};

const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

describe("Bob Effect-RPC migration guardrails", () => {
  it("does not shadow TypeScript schema sources with generated JavaScript", () => {
    const files = sourceFiles(["packages/bob/src/schema/src"]);
    expect(
      files.filter(
        (file) =>
          file.endsWith(".js") &&
          existsSync(join(repoRoot, file.slice(0, -3) + ".ts")),
      ),
    ).toEqual([]);
  });
  it("checks new source files while excluding deleted files and ignored build output", () => {
    const fixture = mkdtempSync(join(tmpdir(), "bob-client-guard-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: fixture });
      writeFileSync(join(fixture, "deleted.ts"), "export {};\n");
      writeFileSync(join(fixture, ".gitignore"), "ignored.ts\n");
      execFileSync("git", ["add", "."], { cwd: fixture });
      rmSync(join(fixture, "deleted.ts"));
      writeFileSync(
        join(fixture, "new route\nfile.ts"),
        'fetch("/api/trpc");\n',
      );
      writeFileSync(join(fixture, "ignored.ts"), 'fetch("/api/trpc");\n');
      writeFileSync(join(fixture, "notes.md"), "/api/trpc");
      expect(sourceFiles(["."], fixture)).toEqual(["new route\nfile.ts"]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("@gmacko/bob-client stays browser-safe", () => {
    const files = sourceFiles(["packages/bob-client/src"]);
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
        .map(
          (token) => `${relative(repoRoot, join(repoRoot, file))}: ${token}`,
        );
    });

    expect(violations).toEqual([]);
  });

  it("does not add unallowlisted Bob-owned /api/trpc production fetches", () => {
    const files = sourceFiles([
      "apps/bob",
      "apps/mobile-bob",
      "packages/bob",
      "packages/bob-client",
    ]);
    const allowed = new Set([
      "apps/bob/src/app/api/trpc/[trpc]/route.ts",
      "apps/bob/src/lib/edge-router.ts",
      "apps/bob/src/server/planning/sync-repos.ts",
      "apps/bob/src/server/rpc.ts",
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
      let text = read(file);
      // Kanbanger owns this endpoint. Keep checking any other tRPC references
      // in these files, and require the production transport's exact origin guard.
      if (
        file === "packages/bob/src/api/src/services/integrations/traceReport.ts"
      ) {
        expect(text).toContain('configured.origin !== "https://tasks.gmac.io"');
        text = text.replace(
          'new URL("/api/trpc/attachment.recordTrace", configured)',
          "",
        );
      }
      if (
        file ===
        "packages/bob/src/api/src/services/integrations/traceReport.test.ts"
      ) {
        text = text.replace(
          "https://tasks.gmac.io/api/trpc/attachment.recordTrace",
          "",
        );
      }
      return text.includes("/api/trpc");
    });

    expect(violations).toEqual([]);
  });

  it("keeps all Bob app consumers off the tRPC React client", () => {
    const files = sourceFiles([
      "apps/bob/src",
      "apps/mobile-bob/src",
      "apps/desktop-bob/src",
    ]);
    const violations = files.filter((file) => {
      if (file.includes("__tests__") || /\.test\.[jt]sx?$/.test(file))
        return false;
      const text = read(file);
      return /(?:~\/trpc\/|@trpc\/tanstack-react-query|\buseTRPC\b|createPlanningCaller)/.test(
        text,
      );
    });
    expect(violations).toEqual([]);
  });
});
