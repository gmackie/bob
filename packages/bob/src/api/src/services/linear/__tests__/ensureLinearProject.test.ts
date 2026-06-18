import { describe, expect, it } from "vitest";

import {
  ensureLinearProject,
  isOpenLinearState,
  mapLinearStatusToBob,
} from "../ensureLinearProject";

/**
 * A Bob project is created for each Linear project so issues have somewhere to
 * land. ensureLinearProject must be idempotent (match on linearProjectId) and
 * generate a unique, column-safe key.
 */

function makeDb(opts: {
  existing?: any;
  existingKeys?: string[];
}) {
  const inserted: any[] = [];
  return {
    inserted,
    query: {
      projects: {
        async findFirst() {
          return opts.existing ?? undefined;
        },
        async findMany() {
          return (opts.existingKeys ?? []).map((key) => ({ key }));
        },
      },
    },
    insert() {
      return {
        values(v: any) {
          inserted.push(v);
          return {
            async returning() {
              return [{ id: "proj-new", ...v }];
            },
          };
        },
      };
    },
  };
}

describe("ensureLinearProject", () => {
  it("returns the existing project without inserting", async () => {
    const db = makeDb({ existing: { id: "p1", linearProjectId: "lin-1" } });
    const res = await ensureLinearProject(db as any, {
      workspaceId: "ws-1",
      linearProjectId: "lin-1",
      name: "Splat GTM",
    });
    expect(res.created).toBe(false);
    expect(res.project.id).toBe("p1");
    expect(db.inserted).toHaveLength(0);
  });

  it("creates a project with a derived key and autoDispatch off by default", async () => {
    const db = makeDb({ existingKeys: [] });
    const res = await ensureLinearProject(db as any, {
      workspaceId: "ws-1",
      linearProjectId: "lin-2",
      name: "Splat GTM",
    });
    expect(res.created).toBe(true);
    expect(res.project.linearProjectId).toBe("lin-2");
    expect(res.project.planningProvider).toBe("linear");
    expect(res.project.key).toBe("SG"); // initials of "Splat GTM"
    expect(res.project.automationSettings).toEqual({ autoDispatch: false });
  });

  it("de-duplicates the key when one already exists in the workspace", async () => {
    const db = makeDb({ existingKeys: ["SG"] });
    const res = await ensureLinearProject(db as any, {
      workspaceId: "ws-1",
      linearProjectId: "lin-3",
      name: "Splat GTM",
    });
    expect(res.project.key).toBe("SG2");
  });

  it("honors an explicit autoDispatch=true", async () => {
    const db = makeDb({ existingKeys: [] });
    const res = await ensureLinearProject(db as any, {
      workspaceId: "ws-1",
      linearProjectId: "lin-4",
      name: "Latchflow",
      autoDispatch: true,
    });
    expect(res.project.automationSettings).toEqual({ autoDispatch: true });
    expect(res.project.key).toBe("LATCHF"); // single word → first 6 chars
  });
});

describe("Linear status mapping", () => {
  it("maps state types to Bob statuses", () => {
    expect(mapLinearStatusToBob("backlog")).toBe("backlog");
    expect(mapLinearStatusToBob("unstarted")).toBe("todo");
    expect(mapLinearStatusToBob("started")).toBe("in_progress");
    expect(mapLinearStatusToBob("completed")).toBe("done");
    expect(mapLinearStatusToBob("canceled")).toBe("cancelled");
  });

  it("treats only completed/canceled as closed", () => {
    expect(isOpenLinearState("started")).toBe(true);
    expect(isOpenLinearState("backlog")).toBe(true);
    expect(isOpenLinearState("completed")).toBe(false);
    expect(isOpenLinearState("canceled")).toBe(false);
  });
});
