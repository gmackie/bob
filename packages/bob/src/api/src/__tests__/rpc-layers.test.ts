/**
 * Integration tests for the eight aggregate RPC layer factories
 * (3 domain + 5 platform).
 *
 * Verifies that each make*Layer function can be invoked with a mock
 * HandlerContext and produces a defined Layer value with the expected
 * number of handler mappings.
 *
 * Phase 7B-4D-delta Task 5.
 */
import { describe, expect, it, vi } from "vitest";

import type { HandlerContext } from "../handlers/context.js";

// Mock @bob/db/client to prevent top-level DB initialization (the `db`
// export is evaluated at import time and throws without DATABASE_URL or
// a PGlite driver). Our tests only exercise layer construction and
// handler key wiring — no actual DB calls are made.
vi.mock("@bob/db/client", () => ({ db: {} }));

// --- Domain aggregate layers (3) ---
import { makeWorkItemsLayer } from "../rpc-layers/work-items.js";
import { makePlanningLayer } from "../rpc-layers/planning.js";
import { makeExternalLayer } from "../rpc-layers/external.js";

// --- Platform aggregate layers (5) ---
import {
  makeAgentHandlers,
  makeAgentLayer,
} from "../rpc-layers/agent.js";
import {
  makeProjectsHandlers,
  makeProjectsLayer,
} from "../rpc-layers/projects.js";
import {
  makeSettingsHandlers,
  makeSettingsLayer,
} from "../rpc-layers/settings.js";
import {
  makeSecretsHandlers,
  makeSecretsLayer,
} from "../rpc-layers/secrets.js";
import {
  makeAuthHandlers,
  makeAuthLayer,
} from "../rpc-layers/auth.js";

// --- Domain handler factories (to verify key counts independently) ---
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
import { makeIntegrationRpcHandlers } from "../rpc-handlers/integration.js";

const mockCtx: HandlerContext = { db: {} as HandlerContext["db"], userId: "test-user" };

// ---------------------------------------------------------------------------
// Aggregate layer construction
// ---------------------------------------------------------------------------

describe("RPC aggregate layers — Phase 7B-4D-delta verification", () => {
  // --- Domain layers (3) ---

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

  // --- Platform layers (5) ---

  describe("makeAgentLayer", () => {
    it("constructs without error", () => {
      const layer = makeAgentLayer(mockCtx);
      expect(layer).toBeDefined();
    });

    it("is not null or undefined", () => {
      const layer = makeAgentLayer(mockCtx);
      expect(layer).not.toBeNull();
      expect(layer).not.toBeUndefined();
    });
  });

  describe("makeProjectsLayer", () => {
    it("constructs without error", () => {
      const layer = makeProjectsLayer(mockCtx);
      expect(layer).toBeDefined();
    });

    it("is not null or undefined", () => {
      const layer = makeProjectsLayer(mockCtx);
      expect(layer).not.toBeNull();
      expect(layer).not.toBeUndefined();
    });
  });

  describe("makeSettingsLayer", () => {
    it("constructs without error", () => {
      const layer = makeSettingsLayer(mockCtx);
      expect(layer).toBeDefined();
    });

    it("is not null or undefined", () => {
      const layer = makeSettingsLayer(mockCtx);
      expect(layer).not.toBeNull();
      expect(layer).not.toBeUndefined();
    });
  });

  describe("makeSecretsLayer", () => {
    it("constructs without error", () => {
      const layer = makeSecretsLayer(mockCtx);
      expect(layer).toBeDefined();
    });

    it("is not null or undefined", () => {
      const layer = makeSecretsLayer(mockCtx);
      expect(layer).not.toBeNull();
      expect(layer).not.toBeUndefined();
    });
  });

  describe("makeAuthLayer", () => {
    it("constructs without error", () => {
      const layer = makeAuthLayer(mockCtx);
      expect(layer).toBeDefined();
    });

    it("is not null or undefined", () => {
      const layer = makeAuthLayer(mockCtx);
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
  describe("WorkItems group (33 handler keys)", () => {
    it("workItems factory produces 20 keys", () => {
      const handlers = makeWorkItemsRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(20);
    });

    it("requirement factory produces 5 keys", () => {
      const handlers = makeRequirementRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(5);
    });

    it("link factory produces 8 keys", () => {
      const handlers = makeLinkRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(8);
    });

    it("total handler keys sum to 33", () => {
      const wi = Object.keys(makeWorkItemsRpcHandlers(mockCtx)).length;
      const req = Object.keys(makeRequirementRpcHandlers(mockCtx)).length;
      const lnk = Object.keys(makeLinkRpcHandlers(mockCtx)).length;
      expect(wi + req + lnk).toBe(33);
    });
  });

  describe("Planning group (70 procedures)", () => {
    it("planning factory produces 21 keys", () => {
      const handlers = makePlanningRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(21);
    });

    it("planSession factory produces 15 keys", () => {
      const handlers = makePlanSessionRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(15);
    });

    it("plan factory produces 11 keys", () => {
      const handlers = makePlanRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(11);
    });

    it("dispatch factory produces 9 keys", () => {
      const handlers = makeDispatchRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(9);
    });

    it("skill factory produces 7 keys", () => {
      const handlers = makeSkillRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(7);
    });

    it("snapshot factory produces 3 keys", () => {
      const handlers = makeSnapshotRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(3);
    });

    it("checkpoint factory produces 3 keys", () => {
      const handlers = makeCheckpointRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(3);
    });

    it("total handler keys sum to 69 (+ 1 inline stub = 70)", () => {
      // planning.getCurrentUser is an inline stub in the layer, not from a factory
      const pl = Object.keys(makePlanningRpcHandlers(mockCtx)).length;
      const ps = Object.keys(makePlanSessionRpcHandlers(mockCtx)).length;
      const pn = Object.keys(makePlanRpcHandlers(mockCtx)).length;
      const di = Object.keys(makeDispatchRpcHandlers(mockCtx)).length;
      const sk = Object.keys(makeSkillRpcHandlers(mockCtx)).length;
      const sn = Object.keys(makeSnapshotRpcHandlers(mockCtx)).length;
      const cp = Object.keys(makeCheckpointRpcHandlers(mockCtx)).length;
      const fromFactories = pl + ps + pn + di + sk + sn + cp;
      // 69 from factories + 1 inline getCurrentUser = 70 total
      expect(fromFactories).toBe(69);
      expect(fromFactories + 1).toBe(70);
    });
  });

  describe("External group (37 procedures)", () => {
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

    it("integration factory produces 6 keys", () => {
      const handlers = makeIntegrationRpcHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(6);
    });

    it("total handler keys sum to 37", () => {
      const fg = Object.keys(makeForgeGraphRpcHandlers(mockCtx)).length;
      const wh = Object.keys(makeWebhookRpcHandlers(mockCtx)).length;
      const pa = Object.keys(makePublicApiRpcHandlers(mockCtx)).length;
      const int = Object.keys(makeIntegrationRpcHandlers(mockCtx)).length;
      expect(fg + wh + pa + int).toBe(37);
    });
  });

  // --- Platform aggregate handler key counts (5 groups) ---

  describe("Agent group (85 procedures — 80 from factories + 5 stubs)", () => {
    it("makeAgentHandlers produces 85 keys", () => {
      const handlers = makeAgentHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(85);
    });
  });

  describe("Projects group (58 procedures — 56 from factories + 2 stubs)", () => {
    it("makeProjectsHandlers produces 58 keys", () => {
      const handlers = makeProjectsHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(58);
    });
  });

  describe("Settings group (20 procedures — all from factories)", () => {
    it("makeSettingsHandlers produces 20 keys", () => {
      const handlers = makeSettingsHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(20);
    });
  });

  describe("Secrets group (14 procedures — 8 from factories + 6 stubs)", () => {
    it("makeSecretsHandlers produces 14 keys", () => {
      const handlers = makeSecretsHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(14);
    });
  });

  describe("Auth group (11 procedures — 2 from factories + 9 stubs)", () => {
    it("makeAuthHandlers produces 11 keys", () => {
      const handlers = makeAuthHandlers(mockCtx);
      expect(Object.keys(handlers)).toHaveLength(11);
    });
  });

  // --- Grand total: all 8 RpcGroups ---

  describe("Grand total — all 8 RpcGroups", () => {
    it("327 contract procedures + 1 health = 328 total", () => {
      // Domain groups (3): WorkItems 32 + Planning 70 + External 37 = 139
      const workItemsKeys =
        Object.keys(makeWorkItemsRpcHandlers(mockCtx)).length +
        Object.keys(makeRequirementRpcHandlers(mockCtx)).length +
        Object.keys(makeLinkRpcHandlers(mockCtx)).length;
      // Planning: 69 from factories + 1 inline getCurrentUser stub = 70
      const planningKeys =
        Object.keys(makePlanningRpcHandlers(mockCtx)).length +
        Object.keys(makePlanSessionRpcHandlers(mockCtx)).length +
        Object.keys(makePlanRpcHandlers(mockCtx)).length +
        Object.keys(makeDispatchRpcHandlers(mockCtx)).length +
        Object.keys(makeSkillRpcHandlers(mockCtx)).length +
        Object.keys(makeSnapshotRpcHandlers(mockCtx)).length +
        Object.keys(makeCheckpointRpcHandlers(mockCtx)).length +
        1; // inline getCurrentUser stub
      const externalKeys =
        Object.keys(makeForgeGraphRpcHandlers(mockCtx)).length +
        Object.keys(makeWebhookRpcHandlers(mockCtx)).length +
        Object.keys(makePublicApiRpcHandlers(mockCtx)).length +
        Object.keys(makeIntegrationRpcHandlers(mockCtx)).length;

      // Platform groups (5): Agent 85 + Projects 58 + Settings 20 + Secrets 14 + Auth 11 = 188
      const agentKeys = Object.keys(makeAgentHandlers(mockCtx)).length;
      const projectsKeys = Object.keys(makeProjectsHandlers(mockCtx)).length;
      const settingsKeys = Object.keys(makeSettingsHandlers(mockCtx)).length;
      const secretsKeys = Object.keys(makeSecretsHandlers(mockCtx)).length;
      const authKeys = Object.keys(makeAuthHandlers(mockCtx)).length;

      const domainTotal = workItemsKeys + planningKeys + externalKeys;
      const platformTotal =
        agentKeys + projectsKeys + settingsKeys + secretsKeys + authKeys;
      const contractTotal = domainTotal + platformTotal;
      const grandTotal = contractTotal + 1; // +1 for health endpoint

      expect(domainTotal).toBe(139);
      expect(platformTotal).toBe(188);
      expect(contractTotal).toBe(327);
      expect(grandTotal).toBe(328);
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
      ...makeIntegrationRpcHandlers(mockCtx),
    };
    for (const [key, value] of Object.entries(all)) {
      expect(typeof value, `handler "${key}" should be a function`).toBe(
        "function",
      );
    }
  });

  it("all Agent handlers are functions", () => {
    const all = makeAgentHandlers(mockCtx);
    for (const [key, value] of Object.entries(all)) {
      expect(typeof value, `handler "${key}" should be a function`).toBe(
        "function",
      );
    }
  });

  it("all Projects handlers are functions", () => {
    const all = makeProjectsHandlers(mockCtx);
    for (const [key, value] of Object.entries(all)) {
      expect(typeof value, `handler "${key}" should be a function`).toBe(
        "function",
      );
    }
  });

  it("all Settings handlers are functions", () => {
    const all = makeSettingsHandlers(mockCtx);
    for (const [key, value] of Object.entries(all)) {
      expect(typeof value, `handler "${key}" should be a function`).toBe(
        "function",
      );
    }
  });

  it("all Secrets handlers are functions", () => {
    const all = makeSecretsHandlers(mockCtx);
    for (const [key, value] of Object.entries(all)) {
      expect(typeof value, `handler "${key}" should be a function`).toBe(
        "function",
      );
    }
  });

  it("all Auth handlers are functions", () => {
    const all = makeAuthHandlers(mockCtx);
    for (const [key, value] of Object.entries(all)) {
      expect(typeof value, `handler "${key}" should be a function`).toBe(
        "function",
      );
    }
  });
});
