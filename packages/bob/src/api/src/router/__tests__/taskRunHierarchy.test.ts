import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { taskRuns } from "@bob/db/schema";

describe("taskRuns run hierarchy schema", () => {
  it("supports root runs and preserves child runs when their parent is deleted", () => {
    expect(taskRuns.parentTaskRunId.notNull).toBe(false);
    expect(taskRuns.parentTaskRunId.getSQLType()).toBe("uuid");
    expect(taskRuns.runPhase.notNull).toBe(true);
    expect(taskRuns.runPhase.default).toBe("execute");
    const foreignKey = getTableConfig(taskRuns).foreignKeys.find((key) =>
      key.reference().columns.includes(taskRuns.parentTaskRunId),
    );
    expect(foreignKey?.reference().foreignTable).toBe(taskRuns);
    expect(foreignKey?.reference().foreignColumns).toEqual([taskRuns.id]);
    expect(foreignKey?.onDelete).toBe("set null");
  });
});
