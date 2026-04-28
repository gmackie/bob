import { describe, it, expect } from "vitest";
import { users } from "@gmacko/core/db/schema/auth";
import { tenants } from "@gmacko/core/db/schema/tenancy";
import { sessionSecrets } from "@gmacko/core/db/schema/secrets";
import { chatConversations } from "@gmacko/core/db/schema/sessions";
import { taskRuns } from "@gmacko/core/db/schema/runner";
import { apiKeys } from "@gmacko/core/db/schema/api-keys";
import { deviceCodes } from "@gmacko/core/db/schema/device-codes";
import { createTestDb } from "@gmacko/core/db/testing";

describe("@gmacko/db subpath exports", () => {
  it("resolves every schema subpath", () => {
    expect(users).toBeDefined();
    expect(tenants).toBeDefined();
    expect(sessionSecrets).toBeDefined();
    expect(chatConversations).toBeDefined();
    expect(taskRuns).toBeDefined();
    expect(apiKeys).toBeDefined();
    expect(deviceCodes).toBeDefined();
  });

  it("exposes testing helpers via the ./testing subpath", () => {
    expect(typeof createTestDb).toBe("function");
  });
});
