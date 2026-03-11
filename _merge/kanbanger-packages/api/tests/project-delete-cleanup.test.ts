import { describe, expect, it } from "vitest";
import { projects, forgeRepositories } from "@linear-clone/db";
import { appRouter } from "../src/routers/index";

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");

  return {
    ...actual,
    eq: (_left: unknown, right: unknown) => ({
      __kind: "eq",
      right,
    }),
  };
});

type ProjectRow = { id: string; forgeRepositoryId: string | null };

function createFakeDb(initialProjects: ProjectRow[], initialRepoIds: string[]) {
  const state = {
    projects: [...initialProjects],
    repoIds: new Set(initialRepoIds),
  };

  function createTx() {
    return {
      select: (fields: Record<string, unknown>) => ({
        from: (table: { tableName?: string }) => ({
          where: (predicate: { right?: string } | undefined) => {
            const isCountQuery = Object.keys(fields).includes("count");
            const value = predicate?.right;

            if (isCountQuery) {
              const count = table === projects
                ? state.projects.filter((project) => project.forgeRepositoryId === value).length
                : 0;

              return Promise.resolve([{ count }]);
            }

            const rows = table === projects
              ? state.projects.filter((project) => project.id === value)
              : [];

            return {
              limit: async () => rows,
            };
          },
        }),
      }),

      delete: (table: { name?: string }) => ({
        where: async (predicate: { right?: string } | undefined) => {
          const value = predicate?.right;

          if (table === projects && value) {
            state.projects = state.projects.filter((project) => project.id !== value);
          }

          if (table === forgeRepositories && value) {
            state.repoIds.delete(value);
          }

          return { success: true };
        },
      }),
    };
  }

  return {
    transaction: async (callback: (tx: ReturnType<typeof createTx>) => Promise<unknown> | unknown) => {
      return callback(createTx() as never);
    },
    state,
  };
}

describe("project.delete", () => {
  it("deletes linked forge repository when no projects remain", async () => {
    const db = createFakeDb(
      [
        { id: "11111111-1111-4111-8111-111111111111", forgeRepositoryId: "22222222-2222-4222-8222-222222222222" },
      ],
      ["22222222-2222-4222-8222-222222222222"]
    );

    const caller = appRouter.createCaller({
      userId: "user-1",
      user: null,
      db,
      scopes: ["read", "write", "admin"],
      authMethod: "session",
    });

    const result = await caller.project.delete({ id: "11111111-1111-4111-8111-111111111111" });

    expect(result.success).toBe(true);
    expect(db.state.projects).toHaveLength(0);
    expect(db.state.repoIds.has("22222222-2222-4222-8222-222222222222")).toBe(false);
  });

  it("keeps shared forge repository until the last project is removed", async () => {
    const db = createFakeDb(
      [
        { id: "11111111-1111-4111-8111-111111111111", forgeRepositoryId: "22222222-2222-4222-8222-222222222222" },
        { id: "33333333-3333-4333-8333-333333333333", forgeRepositoryId: "22222222-2222-4222-8222-222222222222" },
      ],
      ["22222222-2222-4222-8222-222222222222"]
    );

    const caller = appRouter.createCaller({
      userId: "user-1",
      user: null,
      db,
      scopes: ["read", "write", "admin"],
      authMethod: "session",
    });

    const result = await caller.project.delete({ id: "11111111-1111-4111-8111-111111111111" });

    expect(result.success).toBe(true);
    expect(db.state.projects).toHaveLength(1);
    expect(db.state.repoIds.has("22222222-2222-4222-8222-222222222222")).toBe(true);
  });

  it("handles deleting projects without forge repository links", async () => {
    const db = createFakeDb(
      [
        { id: "11111111-1111-4111-8111-111111111111", forgeRepositoryId: null },
      ],
      []
    );

    const caller = appRouter.createCaller({
      userId: "user-1",
      user: null,
      db,
      scopes: ["read", "write", "admin"],
      authMethod: "session",
    });

    const result = await caller.project.delete({ id: "11111111-1111-4111-8111-111111111111" });

    expect(result.success).toBe(true);
    expect(db.state.projects).toHaveLength(0);
    expect(db.state.repoIds.size).toBe(0);
  });
});
