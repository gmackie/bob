import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { runLifecycleEvents, taskRuns } from "@bob/db/schema";

describe("runLifecycleEvents schema", () => {
  it("persists typed lifecycle events attached to a run with cascading deletion", () => {
    expect(getTableName(runLifecycleEvents)).toBe("run_lifecycle_events");
    expect(runLifecycleEvents.taskRunId.notNull).toBe(true);
    expect(runLifecycleEvents.eventType.notNull).toBe(true);
    expect(runLifecycleEvents.phase.notNull).toBe(true);
    expect(runLifecycleEvents.metadata.getSQLType()).toBe("json");
    const foreignKey = getTableConfig(runLifecycleEvents).foreignKeys.find(
      (key) => key.reference().columns.includes(runLifecycleEvents.taskRunId),
    );
    expect(foreignKey?.reference().foreignTable).toBe(taskRuns);
    expect(foreignKey?.reference().foreignColumns).toEqual([taskRuns.id]);
    expect(foreignKey?.onDelete).toBe("cascade");
  });
});
