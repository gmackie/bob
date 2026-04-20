import { describe, it, expect } from "vitest";
import { users } from "@gmacko/db/schema/auth";
import { tenants } from "@gmacko/db/schema/tenancy";
import { sessionSecrets } from "@gmacko/db/schema/secrets";
import { chatConversations } from "@gmacko/db/schema/sessions";
import { taskRuns } from "@gmacko/db/schema/runner";
import { apiKeys } from "@gmacko/db/schema/api-keys";

describe("@gmacko/db subpath exports", () => {
  it("resolves every schema subpath", () => {
    expect(users).toBeDefined();
    expect(tenants).toBeDefined();
    expect(sessionSecrets).toBeDefined();
    expect(chatConversations).toBeDefined();
    expect(taskRuns).toBeDefined();
    expect(apiKeys).toBeDefined();
  });
});
