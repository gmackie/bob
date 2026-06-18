import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  graphExploration,
  threadLink,
  threadLinkKindEnum,
  threadMemory,
  toolCallLog,
} from "../schema/research-buddy";

// Drizzle's getTableConfig returns columns keyed by the TS property name
// (camelCase). The Postgres snake_case names are produced at migration time
// via drizzle.config.ts `casing: "snake_case"`.

describe("research-buddy public schema", () => {
  describe("graphExploration", () => {
    const cfg = getTableConfig(graphExploration);
    const byName = (name: string) =>
      cfg.columns.find((c) => c.name === name)!;

    it("uses id as single-column primary key", () => {
      const idCol = byName("id");
      expect(idCol).toBeDefined();
      expect(idCol.primary).toBe(true);
      expect(idCol.notNull).toBe(true);
    });

    it("threadId is NOT NULL UUID with FK to research_thread", () => {
      const threadId = byName("threadId");
      expect(threadId.notNull).toBe(true);
      // Drizzle maps uuid columns to dataType "string".
      expect(threadId.dataType).toBe("string");
      const fk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "threadId"),
      );
      expect(fk).toBeDefined();
      expect(fk!.reference().foreignTable).toBeDefined();
    });

    it("seed is NOT NULL", () => {
      const seed = byName("seed");
      expect(seed.notNull).toBe(true);
    });

    it("status defaults to 'queued' and is NOT NULL", () => {
      const status = byName("status");
      expect(status.notNull).toBe(true);
      expect(status.default).toBe("queued");
    });

    it("has status+startedAt composite index for poller", () => {
      const idx = cfg.indexes.find(
        (i) => i.config.name === "graph_exploration_status_started_idx",
      );
      expect(idx).toBeDefined();
      const cols = (idx!.config.columns as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toEqual(["status", "startedAt"]);
    });
  });

  describe("threadMemory", () => {
    const cfg = getTableConfig(threadMemory);
    const byName = (name: string) =>
      cfg.columns.find((c) => c.name === name)!;

    it("threadId is the primary key and NOT NULL", () => {
      const threadId = byName("threadId");
      expect(threadId.primary).toBe(true);
      expect(threadId.notNull).toBe(true);
    });

    it("updatedAt is NOT NULL with default", () => {
      const updatedAt = byName("updatedAt");
      expect(updatedAt.notNull).toBe(true);
      expect(updatedAt.hasDefault).toBe(true);
    });

    it("turnsSinceUpdate defaults to 0", () => {
      const t = byName("turnsSinceUpdate");
      expect(t.notNull).toBe(true);
      expect(t.default).toBe(0);
    });

    it("has FK from threadId to research_thread", () => {
      const fk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "threadId"),
      );
      expect(fk).toBeDefined();
    });
  });

  describe("threadLink", () => {
    const cfg = getTableConfig(threadLink);
    const byName = (name: string) =>
      cfg.columns.find((c) => c.name === name)!;

    it("has composite PK on (fromThreadId, toThreadId, kind)", () => {
      expect(cfg.primaryKeys).toHaveLength(1);
      const pk = cfg.primaryKeys[0]!;
      expect(pk.columns.map((c) => c.name).sort()).toEqual([
        "fromThreadId",
        "kind",
        "toThreadId",
      ]);
    });

    it("both endpoints are NOT NULL", () => {
      expect(byName("fromThreadId").notNull).toBe(true);
      expect(byName("toThreadId").notNull).toBe(true);
    });

    it("discoveredAt is NOT NULL with default", () => {
      const d = byName("discoveredAt");
      expect(d.notNull).toBe(true);
      expect(d.hasDefault).toBe(true);
    });

    it("has reverse-lookup index on toThreadId", () => {
      const idx = cfg.indexes.find(
        (i) => i.config.name === "thread_link_to_idx",
      );
      expect(idx).toBeDefined();
    });

    it("has FKs from both endpoints to research_thread", () => {
      const fromFk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "fromThreadId"),
      );
      const toFk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "toThreadId"),
      );
      expect(fromFk).toBeDefined();
      expect(toFk).toBeDefined();
    });

    it("does NOT include cold_thread_update in the kind enum (computed dashboard-side)", () => {
      expect(threadLinkKindEnum.enumValues).not.toContain(
        "cold_thread_update",
      );
      expect(threadLinkKindEnum.enumValues).toEqual([
        "topic_overlap",
        "citation_overlap",
        "question_answered",
        "supersedes",
        "entity_overlap",
      ]);
    });
  });

  describe("toolCallLog", () => {
    const cfg = getTableConfig(toolCallLog);
    const byName = (name: string) =>
      cfg.columns.find((c) => c.name === name)!;

    it("id is primary key", () => {
      const id = byName("id");
      expect(id.primary).toBe(true);
      expect(id.notNull).toBe(true);
    });

    it("threadId is NOT NULL (tool calls are thread-scoped)", () => {
      expect(byName("threadId").notNull).toBe(true);
    });

    it("toolName is NOT NULL", () => {
      expect(byName("toolName").notNull).toBe(true);
    });

    it("startedAt is NOT NULL with default", () => {
      const s = byName("startedAt");
      expect(s.notNull).toBe(true);
      expect(s.hasDefault).toBe(true);
    });

    it("has threadId+startedAt index for reverse-chron filter", () => {
      const idx = cfg.indexes.find(
        (i) => i.config.name === "tool_call_log_thread_started_idx",
      );
      expect(idx).toBeDefined();
      const cols = (idx!.config.columns as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toEqual(["threadId", "startedAt"]);
    });

    it("has FK to research_thread on threadId", () => {
      const fk = cfg.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "threadId"),
      );
      expect(fk).toBeDefined();
    });
  });
});
