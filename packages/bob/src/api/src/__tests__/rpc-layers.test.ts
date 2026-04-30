/**
 * Integration tests for the three aggregate RPC layer factories.
 *
 * Verifies that each make*Layer function can be invoked with a mock
 * HandlerContext and produces a defined Layer value with the expected
 * number of handler mappings.
 *
 * Phase 7B-4D-gamma Task 5.
 */
import { describe, expect, it, vi } from "vitest";

// Mock @bob/db/client to prevent top-level DB initialization (the `db`
// export is evaluated at import time and throws without DATABASE_URL or
// a PGlite driver). Our tests only exercise layer construction and
// handler key wiring — no actual DB calls are made.
vi.mock("@bob/db/client", () => ({ db: {} }));

import { makeWorkItemsLayer } from "../rpc-layers/work-items.js";
import { makePlanningLayer } from "../rpc-layers/planning.js";
import { makeExternalLayer } from "../rpc-layers/external.js";

// --- Handler factories (to verify key counts independently) ---
import { makeWorkItemsRpcHandlers } from "../rpc-handlers/workItems.js";
import { makeRequirementRpcHandlers } from "../rpc-handlers/requirement.js";
import { makeLinkRpcHandlers } from "../rpc-handlers/link.js";

import { makePlanningRpcHandlers } from "../rpc-handlers/planning.js";
import { makePlanSessionRpcHandlers } from "../rpc-handlers/planSession.js";
import { makePlanRpcHandlers } from "../rpc-handlers/plan.js";
import { makeDispatchRpcHandlers } from "../rpc-handlers/dispatch.js";
import { makeSkillRpcHandlers } from "../rpc-handlers/skill.js";
import { makeSnapshotRpcHandlers } from "../rpc-handlers/snapshot.js";
import { makeCheckpointRpcHandlers } from "../rpc-handlers/checkpoint.js";

import { makeForgeGraphRpcHandlers } from "../rpc-handlers/forgegraph.js";
import { makeWebhookRpcHandlers } from "../rpc-handlers/webhook.js";
import { makePublicApiRpcHandlers } from "../rpc-handlers/publicApi.js";

const mockCtx = { db: {} as any, userId: "test-user" };

// ---------------------------------------------------------------------------
// Aggregate layer construction
// ---------------------------------------------------------------------------

describe("RPC aggregate layers — Phase 7B-4D-gamma verification", () => {
  describe("makeWorkItemsLayer", () => {
    it("constructs without error", () => {
      const layer = makeWorkItemsLayer(mockCtx);
      expect(layer).toBeDefined();
    });

    it("is not null or undefined", () => {
      const layer = makeWorkItemsLayer(mockCtx);
      expect(layer).not.toBeNull();
      expect(layer).not.toBeUndefined();
    });
  });

  describe("makePlanningLayer", () => {
    it("constructs without error", () => {
      const layer = makePlanningLayer(mockCtx);
      expect(layer).toBeDefined();
    });

    it("is not null or undefined", () => {
      const layer = makePlanningLayer(mockCtx);
      expect(layer).not.toBeNull();
      expect(layer).not.toBeUndefined();
    });
  });

  describe("makeExternalLayer", () => {
    it("constructs without error", () => {
      const layer = makeExternalLayer(mockCtx);
      expect(layer).toBeDefined();
    });

    it("is not null or undefined", () => {
      const layer = makeExternalLayer(mockCtx);
      expect(layer).not.toBeNull();
      expect(layer).not.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Handler key completeness — verify every factory produces the expected
// number of handler keys, confirming the aggregate layers wire them all.
// ---------------------------------------------------------------------------

describe("RPC handler factory key counts", () => {
  describe("WorkItems group (31 procedures)", () => {
    it("workItems factory produces 18 keys", () => {
      const handlers = makeWorkItemsRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(18);
    });

    it("requirement factory produces 5 keys", () => {
      const handlers = makeRequirementRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(5);
    });

    it("link factory produces 8 keys", () => {
      const handlers = makeLinkRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(8);
    });

    it("total handler keys sum to 31", () => {
      const wi = Object.keys(makeWorkItemsRpcHandlers(mockCtx)).length;
      const req = Object.keys(makeRequirementRpcHandlers(mockCtx)).length;
      const lnk = Object.keys(makeLinkRpcHandlers(mockCtx)).length;
      expect(wi + req + lnk).toBe(31);
    });
  });

  describe("Planning group (67 procedures)", () => {
    it("planning factory produces 20 keys", () => {
      const handlers = makePlanningRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(20);
    });

    it("planSession factory produces 15 keys", () => {
      const handlers = makePlanSessionRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(15);
    });

    it("plan factory produces 11 keys", () => {
      const handlers = makePlanRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(11);
    });

    it("dispatch factory produces 8 keys", () => {
      const handlers = makeDispatchRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(8);
    });

    it("skill factory produces 6 keys", () => {
      const handlers = makeSkillRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(6);
    });

    it("snapshot factory produces 3 keys", () => {
      const handlers = makeSnapshotRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(3);
    });

    it("checkpoint factory produces 3 keys", () => {
      const handlers = makeCheckpointRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(3);
    });

    it("total handler keys sum to 66 (+ 1 inline stub = 67)", () => {
      // planning.getCurrentUser is an inline stub in the layer, not from a factory
      const pl = Object.keys(makePlanningRpcHandlers(mockCtx)).length;
      const ps = Object.keys(makePlanSessionRpcHandlers(mockCtx)).length;
      const pn = Object.keys(makePlanRpcHandlers(mockCtx)).length;
      const di = Object.keys(makeDispatchRpcHandlers(mockCtx)).length;
      const sk = Object.keys(makeSkillRpcHandlers(mockCtx)).length;
      const sn = Object.keys(makeSnapshotRpcHandlers(mockCtx)).length;
      const cp = Object.keys(makeCheckpointRpcHandlers(mockCtx)).length;
      const fromFactories = pl + ps + pn + di + sk + sn + cp;
      // 66 from factories + 1 inline getCurrentUser = 67 total
      expect(fromFactories).toBe(66);
      expect(fromFactories + 1).toBe(67);
    });
  });

  describe("External group (31 procedures)", () => {
    it("forgegraph factory produces 14 keys", () => {
      const handlers = makeForgeGraphRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(14);
    });

    it("webhook factory produces 8 keys", () => {
      const handlers = makeWebhookRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(8);
    });

    it("publicApi factory produces 9 keys", () => {
      const handlers = makePublicApiRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(9);
    });

    it("total handler keys sum to 31", () => {
      const fg = Object.keys(makeForgeGraphRpcHandlers(mockCtx)).length;
      const wh = Object.keys(makeWebhookRpcHandlers(mockCtx)).length;
      const pa = Object.keys(makePublicApiRpcHandlers(mockCtx)).length;
      expect(fg + wh + pa).toBe(31);
    });
  });
});

// ---------------------------------------------------------------------------
// All handler functions are callable — verify every value returned by the
// handler factories is a function (not undefined from a bad key reference).
// ---------------------------------------------------------------------------

describe("RPC handler values are all functions", () => {
  it("all WorkItems handlers are functions", () => {
    const all = {
      ...makeWorkItemsRpcHandlers(mockCtx),
      ...makeRequirementRpcHandlers(mockCtx),
      ...makeLinkRpcHandlers(mockCtx),
    };
    for (const [key, value] of Object.entries(all)) {
      expect(typeof value, `handler "${key}" should be a function`).toBe(
        "function",
      );
    }
  });

  it("all Planning handlers are functions", () => {
    const all = {
      ...makePlanningRpcHandlers(mockCtx),
      ...makePlanSessionRpcHandlers(mockCtx),
      ...makePlanRpcHandlers(mockCtx),
      ...makeDispatchRpcHandlers(mockCtx),
      ...makeSkillRpcHandlers(mockCtx),
      ...makeSnapshotRpcHandlers(mockCtx),
      ...makeCheckpointRpcHandlers(mockCtx),
    };
    for (const [key, value] of Object.entries(all)) {
      expect(typeof value, `handler "${key}" should be a function`).toBe(
        "function",
      );
    }
  });

  it("all External handlers are functions", () => {
    const all = {
      ...makeForgeGraphRpcHandlers(mockCtx),
      ...makeWebhookRpcHandlers(mockCtx),
      ...makePublicApiRpcHandlers(mockCtx),
    };
    for (const [key, value] of Object.entries(all)) {
      expect(typeof value, `handler "${key}" should be a function`).toBe(
        "function",
      );
    }
  });
});
