import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  personalVaultFindingsInbox,
  personalVaultGraphEdges,
  personalVaultGraphNodes,
  personalVaultS2Cache,
  personalVaultStandingInterests,
  researchVaultFindingsInbox,
  researchVaultFindingsTriageEnum,
  researchVaultGraphEdgeKindEnum,
  researchVaultGraphEdges,
  researchVaultGraphNodes,
  researchVaultS2Cache,
  researchVaultStandingInterests,
  CreateFindingsInboxSchema,
  CreateGraphEdgeSchema,
  CreateGraphNodeSchema,
  CreateStandingInterestSchema,
} from "../schema/vault-taxonomy";

// Drizzle's getTableConfig reports columns by their TS property name
// (camelCase). Postgres snake_case is produced at migration time via
// drizzle.config.ts `casing: "snake_case"`. Indexes use `.on(t.foo)`,
// which also resolves to the TS name, so expected column lists below
// are camelCase.

describe("vault-taxonomy buddy tables — research_vault", () => {
  describe("graphNode", () => {
    const cfg = getTableConfig(researchVaultGraphNodes);
    const byName = (name: string) =>
      cfg.columns.find((c) => c.name === name)!;

    it("is placed in the research_vault schema", () => {
      expect(cfg.schema).toBe("research_vault");
    });

    it("uses sourceId as the sole primary key", () => {
      const sourceId = byName("sourceId");
      expect(sourceId).toBeDefined();
      expect(sourceId.primary).toBe(true);
      expect(sourceId.notNull).toBe(true);
      // getTableConfig exposes an empty primaryKeys[] when PK is inline on
      // a single column.
      expect(cfg.primaryKeys).toHaveLength(0);
    });

    it("has FK from sourceId → sources with onDelete cascade", () => {
      const fk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "sourceId"),
      );
      expect(fk).toBeDefined();
      expect(fk!.onDelete).toBe("cascade");
    });

    it("s2PaperId is unique", () => {
      const s2 = byName("s2PaperId");
      expect(s2).toBeDefined();
      expect(s2.isUnique).toBe(true);
    });

    it("exposes openalexId, doi, influenceScore, firstSeenExploration", () => {
      expect(byName("openalexId")).toBeDefined();
      expect(byName("doi")).toBeDefined();
      expect(byName("influenceScore")).toBeDefined();
      expect(byName("firstSeenExploration")).toBeDefined();
    });

    it("firstSeenExploration has FK → graph_exploration with onDelete set null", () => {
      const fk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "firstSeenExploration"),
      );
      expect(fk).toBeDefined();
      expect(fk!.onDelete).toBe("set null");
      // Cross-schema reference into public.graph_exploration(id).
      const refCols = fk!
        .reference()
        .foreignColumns.map((c: { name: string }) => c.name);
      expect(refCols).toEqual(["id"]);
      const foreignCfg = getTableConfig(fk!.reference().foreignTable);
      expect(foreignCfg.name).toBe("graph_exploration");
    });
  });

  describe("graphEdge", () => {
    const cfg = getTableConfig(researchVaultGraphEdges);
    const byName = (name: string) =>
      cfg.columns.find((c) => c.name === name)!;

    it("is placed in the research_vault schema", () => {
      expect(cfg.schema).toBe("research_vault");
    });

    it("has composite PK on (fromSourceId, toSourceId, kind)", () => {
      expect(cfg.primaryKeys).toHaveLength(1);
      const pk = cfg.primaryKeys[0]!;
      expect(pk.columns.map((c) => c.name).sort()).toEqual([
        "fromSourceId",
        "kind",
        "toSourceId",
      ]);
    });

    it("both endpoints are NOT NULL and cascade on delete", () => {
      expect(byName("fromSourceId").notNull).toBe(true);
      expect(byName("toSourceId").notNull).toBe(true);
      const fks = cfg.foreignKeys;
      const fromFk = fks.find((f) =>
        f.reference().columns.some((c) => c.name === "fromSourceId"),
      );
      const toFk = fks.find((f) =>
        f.reference().columns.some((c) => c.name === "toSourceId"),
      );
      expect(fromFk).toBeDefined();
      expect(fromFk!.onDelete).toBe("cascade");
      expect(toFk).toBeDefined();
      expect(toFk!.onDelete).toBe("cascade");
    });

    it("has reverse-lookup index on toSourceId", () => {
      const idx = cfg.indexes.find(
        (i) => i.config.name === "graph_edge_to_idx",
      );
      expect(idx).toBeDefined();
      const cols = (idx!.config.columns as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toEqual(["toSourceId"]);
    });

    it("discoveredIn has FK → graph_exploration with onDelete set null", () => {
      const fk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "discoveredIn"),
      );
      expect(fk).toBeDefined();
      expect(fk!.onDelete).toBe("set null");
      const foreignCfg = getTableConfig(fk!.reference().foreignTable);
      expect(foreignCfg.name).toBe("graph_exploration");
    });
  });

  describe("standingInterest", () => {
    const cfg = getTableConfig(researchVaultStandingInterests);
    const byName = (name: string) =>
      cfg.columns.find((c) => c.name === name)!;

    it("is placed in the research_vault schema", () => {
      expect(cfg.schema).toBe("research_vault");
    });

    it("id is a UUID primary key", () => {
      const id = byName("id");
      expect(id.primary).toBe(true);
      expect(id.notNull).toBe(true);
      expect(id.dataType).toBe("string"); // drizzle maps uuid → "string"
    });

    it("label is NOT NULL", () => {
      expect(byName("label").notNull).toBe(true);
    });

    it("enabled defaults to true and is NOT NULL", () => {
      const enabled = byName("enabled");
      expect(enabled.notNull).toBe(true);
      expect(enabled.default).toBe(true);
    });

    it("cadenceSeconds defaults to 7200 and is NOT NULL", () => {
      const cadence = byName("cadenceSeconds");
      expect(cadence.notNull).toBe(true);
      expect(cadence.default).toBe(7200);
    });

    it("autoDisableSuggested defaults false", () => {
      const a = byName("autoDisableSuggested");
      expect(a.notNull).toBe(true);
      expect(a.default).toBe(false);
    });

    it("queryTerms and seedSourceIds are arrays and NOT NULL with defaults", () => {
      const qt = byName("queryTerms");
      const ss = byName("seedSourceIds");
      expect(qt).toBeDefined();
      expect(ss).toBeDefined();
      expect(qt.notNull).toBe(true);
      expect(ss.notNull).toBe(true);
      expect(qt.hasDefault).toBe(true);
      expect(ss.hasDefault).toBe(true);
      // Drizzle tags array columns with columnType "PgArray".
      expect(qt.columnType).toBe("PgArray");
      expect(ss.columnType).toBe("PgArray");
    });

    it("seedSourceIds inner element type is integer (matches sources.id serial)", () => {
      // Drizzle exposes the array's element column on `baseColumn`. For
      // integer[] we expect columnType === "PgInteger" and SQL type "integer".
      const ss = byName("seedSourceIds") as unknown as {
        baseColumn?: { columnType: string; getSQLType: () => string };
      };
      expect(ss.baseColumn).toBeDefined();
      expect(ss.baseColumn!.columnType).toBe("PgInteger");
      expect(ss.baseColumn!.getSQLType()).toBe("integer");
    });

    it("threadId is nullable (interest can be vault-global)", () => {
      expect(byName("threadId").notNull).toBe(false);
    });

    it("has index on (enabled, lastRunAt) for scheduler poller", () => {
      const idx = cfg.indexes.find(
        (i) => i.config.name === "standing_interest_enabled_last_run_idx",
      );
      expect(idx).toBeDefined();
      const cols = (idx!.config.columns as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toEqual(["enabled", "lastRunAt"]);
    });
  });

  describe("findingsInbox", () => {
    const cfg = getTableConfig(researchVaultFindingsInbox);
    const byName = (name: string) =>
      cfg.columns.find((c) => c.name === name)!;

    it("is placed in the research_vault schema", () => {
      expect(cfg.schema).toBe("research_vault");
    });

    it("id is UUID primary key", () => {
      expect(byName("id").primary).toBe(true);
    });

    it("sourceId is NOT NULL with cascading FK", () => {
      expect(byName("sourceId").notNull).toBe(true);
      const fk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "sourceId"),
      );
      expect(fk).toBeDefined();
      expect(fk!.onDelete).toBe("cascade");
    });

    it("standingInterestId has cascading FK (nullable)", () => {
      expect(byName("standingInterestId").notNull).toBe(false);
      const fk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "standingInterestId"),
      );
      expect(fk).toBeDefined();
      expect(fk!.onDelete).toBe("cascade");
    });

    it("foundAt is NOT NULL with default", () => {
      const f = byName("foundAt");
      expect(f.notNull).toBe(true);
      expect(f.hasDefault).toBe(true);
    });

    it("triage defaults to 'pending' and is NOT NULL", () => {
      const triage = byName("triage");
      expect(triage.notNull).toBe(true);
      expect(triage.default).toBe("pending");
    });

    it("has index on (triage, foundAt) with foundAt DESC for newest-first", () => {
      const idx = cfg.indexes.find(
        (i) => i.config.name === "findings_inbox_triage_found_idx",
      );
      expect(idx).toBeDefined();
      const cols = idx!.config.columns as Array<{
        name: string;
        indexConfig?: { order?: "asc" | "desc" };
      }>;
      expect(cols.map((c) => c.name)).toEqual(["triage", "foundAt"]);
      // Second column (foundAt) should be DESC so the "pending, newest
      // first" dashboard query uses a forward index scan.
      expect(cols[1]!.indexConfig?.order).toBe("desc");
    });
  });

  describe("s2Cache", () => {
    const cfg = getTableConfig(researchVaultS2Cache);
    const byName = (name: string) =>
      cfg.columns.find((c) => c.name === name)!;

    it("is placed in the research_vault schema", () => {
      expect(cfg.schema).toBe("research_vault");
    });

    it("key is the primary key", () => {
      const key = byName("key");
      expect(key.primary).toBe(true);
      expect(key.notNull).toBe(true);
    });

    it("responseJson is NOT NULL", () => {
      expect(byName("responseJson").notNull).toBe(true);
    });

    it("fetchedAt is NOT NULL with default", () => {
      const f = byName("fetchedAt");
      expect(f.notNull).toBe(true);
      expect(f.hasDefault).toBe(true);
    });

    it("expiresAt is NOT NULL", () => {
      expect(byName("expiresAt").notNull).toBe(true);
    });

    it("has index on expiresAt for TTL cleanup", () => {
      const idx = cfg.indexes.find(
        (i) => i.config.name === "s2_cache_expires_at_idx",
      );
      expect(idx).toBeDefined();
      const cols = (idx!.config.columns as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toEqual(["expiresAt"]);
    });
  });
});

describe("vault-taxonomy buddy tables — personal_vault mirror", () => {
  it("graph_node is placed in personal_vault", () => {
    expect(getTableConfig(personalVaultGraphNodes).schema).toBe(
      "personal_vault",
    );
  });

  it("graph_edge is placed in personal_vault", () => {
    expect(getTableConfig(personalVaultGraphEdges).schema).toBe(
      "personal_vault",
    );
  });

  it("standing_interest is placed in personal_vault", () => {
    expect(getTableConfig(personalVaultStandingInterests).schema).toBe(
      "personal_vault",
    );
  });

  it("findings_inbox is placed in personal_vault", () => {
    expect(getTableConfig(personalVaultFindingsInbox).schema).toBe(
      "personal_vault",
    );
  });

  it("s2_cache is placed in personal_vault", () => {
    expect(getTableConfig(personalVaultS2Cache).schema).toBe("personal_vault");
  });
});

describe("vault-taxonomy buddy enums", () => {
  it("graph_edge_kind enum has exactly the four expected values", () => {
    // Regression guard — no unexpected kinds silently added.
    expect(researchVaultGraphEdgeKindEnum.enumValues).toEqual([
      "cites",
      "references",
      "similar_embedding",
      "recommended_by_s2",
    ]);
  });

  it("findings_triage enum has exactly the four expected values", () => {
    expect(researchVaultFindingsTriageEnum.enumValues).toEqual([
      "pending",
      "saved",
      "dismissed",
      "promoted",
    ]);
  });
});

describe("vault-taxonomy buddy insert schemas", () => {
  it("CreateStandingInterestSchema omits auto-managed columns", () => {
    const parsed = CreateStandingInterestSchema.safeParse({
      label: "sleep science",
      queryTerms: ["sleep", "circadian"],
      seedSourceIds: [],
      cadenceSeconds: 3600,
      enabled: true,
    });
    expect(parsed.success).toBe(true);
    // id / lastRunAt / lastCursor / lastError / autoDisableSuggested
    // should be stripped, not required.
    expect("id" in (CreateStandingInterestSchema.shape as object)).toBe(false);
    expect("lastRunAt" in (CreateStandingInterestSchema.shape as object)).toBe(
      false,
    );
    expect(
      "autoDisableSuggested" in
        (CreateStandingInterestSchema.shape as object),
    ).toBe(false);
  });

  it("CreateFindingsInboxSchema omits auto-managed columns", () => {
    expect("id" in (CreateFindingsInboxSchema.shape as object)).toBe(false);
    expect("foundAt" in (CreateFindingsInboxSchema.shape as object)).toBe(
      false,
    );
    expect("triageAt" in (CreateFindingsInboxSchema.shape as object)).toBe(
      false,
    );
  });

  it("CreateGraphNodeSchema exposes graph_node columns", () => {
    expect("sourceId" in (CreateGraphNodeSchema.shape as object)).toBe(true);
    expect("s2PaperId" in (CreateGraphNodeSchema.shape as object)).toBe(true);
  });

  it("CreateGraphEdgeSchema exposes graph_edge columns", () => {
    expect("fromSourceId" in (CreateGraphEdgeSchema.shape as object)).toBe(
      true,
    );
    expect("toSourceId" in (CreateGraphEdgeSchema.shape as object)).toBe(true);
    expect("kind" in (CreateGraphEdgeSchema.shape as object)).toBe(true);
  });
});
