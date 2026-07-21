import { and, eq } from "@bob/db";
import {
  chatConversations,
  projectDeploySecretBindings,
  projects,
  sessionSecrets,
  sessionSecretUsages,
} from "@bob/db/schema";

import { auditSecretAccess } from "../crypto/secretAccessAudit";
import {
  decryptSessionSecretValue,
  encryptSessionSecretValue,
} from "../crypto/sessionSecretVault";
import type { DeployEnvironment, ForgeGraphSecretAdapter } from "./forgegraphSecretAdapter";

type ChatConversationRow = typeof chatConversations.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type SessionSecretRow = typeof sessionSecrets.$inferSelect;
type SessionSecretUsageRow = typeof sessionSecretUsages.$inferSelect;
type ProjectDeploySecretBindingRow = typeof projectDeploySecretBindings.$inferSelect;

/**
 * Reads an optional string-typed field off a value whose shape isn't
 * statically guaranteed to include it. chatConversations has no
 * `workspaceId`/`projectId` columns (only `planningWorkspaceId`/
 * `planningProjectId`) — this read has always resolved to `undefined` in
 * practice (masked before by the `any`-typed DatabaseLike interface), so
 * this narrow helper preserves that exact (dead-field) behavior rather
 * than silently switching to the differently-named planning* columns,
 * which would be a real behavior change out of scope for a lint-only pass.
 */
function readOptionalStringField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null || !(field in value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[field];
  return typeof raw === "string" ? raw : null;
}

export interface DatabaseLike {
  query: {
    chatConversations?: {
      findFirst: (args: unknown) => Promise<ChatConversationRow | undefined>;
    };
    projects?: {
      findFirst: (args: unknown) => Promise<ProjectRow | undefined>;
    };
    sessionSecrets?: {
      findFirst?: (args: unknown) => Promise<SessionSecretRow | undefined>;
      findMany: (args: unknown) => Promise<SessionSecretRow[]>;
    };
    sessionSecretUsages?: {
      findMany?: (args: unknown) => Promise<SessionSecretUsageRow[]>;
    };
  };
  insert(table: typeof sessionSecrets): {
    values: (values: unknown) => {
      returning: () => Promise<SessionSecretRow[]>;
    };
  };
  insert(table: typeof sessionSecretUsages): {
    values: (values: unknown) => {
      returning: () => Promise<SessionSecretUsageRow[]>;
    };
  };
  insert(table: typeof projectDeploySecretBindings): {
    values: (values: unknown) => {
      returning: () => Promise<ProjectDeploySecretBindingRow[]>;
      onConflictDoUpdate: (args: unknown) => {
        returning: () => Promise<ProjectDeploySecretBindingRow[]>;
      };
    };
  };
  delete: (table: unknown) => {
    where: (where: unknown) => {
      returning: () => Promise<SessionSecretRow[]>;
    };
  };
  update: (table: unknown) => {
    set: (values: unknown) => {
      where: (where: unknown) => {
        returning: () => Promise<SessionSecretRow[]>;
      };
    };
  };
}

export interface SessionSecretPolicy {
  allowedTemplates?: string[];
  redactOutput?: boolean;
  maxUses?: number | null;
  templatePolicies?: Record<
    string,
    {
      allowedArgPrefixes?: Record<string, string[]>;
    }
  >;
}

export class SessionSecretService {
  constructor(private readonly db: DatabaseLike) {}

  async requireOwnedSession(sessionId: string, userId: string) {
    const session = await this.db.query.chatConversations?.findFirst({
      where: and(
        eq(chatConversations.id, sessionId),
        eq(chatConversations.userId, userId),
      ),
    });

    if (!session) {
      throw new Error("Session not found or not owned by this user");
    }

    return session;
  }

  async requireOwnedProject(projectId: string) {
    const project = await this.db.query.projects?.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) {
      throw new Error("Project not found");
    }

    return project;
  }

  async createSessionSecret(input: {
    userId: string;
    sessionId: string;
    label: string;
    handle: string;
    value: string;
    transport: string;
    policy: SessionSecretPolicy;
  }) {
    const session = await this.requireOwnedSession(input.sessionId, input.userId);
    const id = crypto.randomUUID();
    const encrypted = encryptSessionSecretValue(input.value, id);

    const [created] = await this.db
      .insert(sessionSecrets)
      .values({
        id,
        userId: input.userId,
        sessionId: input.sessionId,
        workspaceId: readOptionalStringField(session, "workspaceId"),
        projectId: readOptionalStringField(session, "projectId"),
        label: input.label,
        handle: input.handle,
        transport: input.transport,
        status: "active",
        provider: "bob",
        source: "pasted",
        valueCiphertext: encrypted.ciphertext,
        valueIv: encrypted.iv,
        valueTag: encrypted.tag,
        policy: input.policy,
      })
      .returning();

    return this.toPublicSecret(created ?? {
      id,
      sessionId: input.sessionId,
      label: input.label,
      handle: input.handle,
      transport: input.transport,
      status: "active",
      provider: "bob",
      policy: input.policy,
    });
  }

  async listSessionSecrets(input: { sessionId: string; userId: string }) {
    await this.requireOwnedSession(input.sessionId, input.userId);
    const rows = await this.db.query.sessionSecrets?.findMany({
      where: eq(sessionSecrets.sessionId, input.sessionId),
    });

    return (rows ?? []).map((row) => this.toPublicSecret(row));
  }

  async deleteSessionSecret(input: { secretId: string; userId: string }) {
    const existing = await this.db.query.sessionSecrets?.findFirst?.({
      where: eq(sessionSecrets.id, input.secretId),
    });

    if (existing?.userId !== input.userId) {
      throw new Error("Session secret not found");
    }

    const deleted = await this.db
      .delete(sessionSecrets)
      .where(eq(sessionSecrets.id, input.secretId))
      .returning();

    return { deleted: deleted.length };
  }

  async markSecretUsed(input: {
    secretId: string;
    sessionId: string;
    executor: string;
    templateId?: string;
    commandPreview?: string;
    exitCode?: number;
    durationMs?: number;
  }) {
    const [usage] = await this.db
      .insert(sessionSecretUsages)
      .values({
        id: crypto.randomUUID(),
        secretId: input.secretId,
        sessionId: input.sessionId,
        executor: input.executor,
        templateId: input.templateId,
        commandPreview: input.commandPreview,
        exitCode: input.exitCode,
        durationMs: input.durationMs,
      })
      .returning();

    return usage ?? {
      secretId: input.secretId,
      sessionId: input.sessionId,
      executor: input.executor,
      templateId: input.templateId,
    };
  }

  async getSecretForExecution(input: { secretId: string; userId: string }) {
    const row = await this.db.query.sessionSecrets?.findFirst?.({
      where: eq(sessionSecrets.id, input.secretId),
    });

    if (row?.userId !== input.userId) {
      auditSecretAccess({
        resource: "session_secret",
        action: "decrypt",
        userId: input.userId,
        resourceId: input.secretId,
        success: false,
        detail: "not found or not owned",
      });
      throw new Error("Session secret not found");
    }

    if (!row.valueCiphertext || !row.valueIv || !row.valueTag) {
      auditSecretAccess({
        resource: "session_secret",
        action: "decrypt",
        userId: input.userId,
        sessionId: row.sessionId,
        resourceId: row.id,
        success: false,
        detail: "missing encrypted value",
      });
      throw new Error("Session secret is missing its encrypted value");
    }

    let value: string;
    try {
      value = decryptSessionSecretValue(
        {
          ciphertext: row.valueCiphertext,
          iv: row.valueIv,
          tag: row.valueTag,
        },
        row.id,
      );
    } catch (err) {
      auditSecretAccess({
        resource: "session_secret",
        action: "decrypt",
        userId: input.userId,
        sessionId: row.sessionId,
        resourceId: row.id,
        success: false,
        detail: err instanceof Error ? err.message : "decrypt failed",
      });
      throw err;
    }

    // Durable audit trail — every plaintext fetch is a use event.
    await this.db
      .insert(sessionSecretUsages)
      .values({
        id: crypto.randomUUID(),
        secretId: row.id,
        sessionId: row.sessionId,
        executor: "api-decrypt",
        templateId: null,
        commandPreview: "getSecretForExecution",
      })
      .returning();

    await this.db
      .update(sessionSecrets)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(sessionSecrets.id, row.id))
      .returning();

    const usageCount = (
      await this.db.query.sessionSecretUsages?.findMany?.({
        where: eq(sessionSecretUsages.secretId, row.id),
      })
    )?.length;

    auditSecretAccess({
      resource: "session_secret",
      action: "decrypt",
      userId: input.userId,
      sessionId: row.sessionId,
      resourceId: row.id,
      success: true,
    });

    return {
      ...this.toPublicSecret(row),
      usageCount: usageCount ?? 0,
      value,
    };
  }

  async getSecretForSessionExecution(input: {
    sessionId: string;
    handle: string;
    userId: string;
  }) {
    await this.requireOwnedSession(input.sessionId, input.userId);

    const row = await this.db.query.sessionSecrets?.findFirst?.({
      where: and(
        eq(sessionSecrets.sessionId, input.sessionId),
        eq(sessionSecrets.handle, input.handle),
      ),
    });

    if (row?.userId !== input.userId) {
      auditSecretAccess({
        resource: "session_secret",
        action: "decrypt_for_session",
        userId: input.userId,
        sessionId: input.sessionId,
        success: false,
        detail: "not found or not owned",
      });
      throw new Error("Session secret not found");
    }

    if (!row.valueCiphertext || !row.valueIv || !row.valueTag) {
      auditSecretAccess({
        resource: "session_secret",
        action: "decrypt_for_session",
        userId: input.userId,
        sessionId: row.sessionId,
        resourceId: row.id,
        success: false,
        detail: "missing encrypted value",
      });
      throw new Error("Session secret is missing its encrypted value");
    }

    let value: string;
    try {
      value = decryptSessionSecretValue(
        {
          ciphertext: row.valueCiphertext,
          iv: row.valueIv,
          tag: row.valueTag,
        },
        row.id,
      );
    } catch (err) {
      auditSecretAccess({
        resource: "session_secret",
        action: "decrypt_for_session",
        userId: input.userId,
        sessionId: row.sessionId,
        resourceId: row.id,
        success: false,
        detail: err instanceof Error ? err.message : "decrypt failed",
      });
      throw err;
    }

    await this.db
      .insert(sessionSecretUsages)
      .values({
        id: crypto.randomUUID(),
        secretId: row.id,
        sessionId: row.sessionId,
        executor: "api-decrypt",
        templateId: null,
        commandPreview: "getSecretForSessionExecution",
      })
      .returning();

    await this.db
      .update(sessionSecrets)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(sessionSecrets.id, row.id))
      .returning();

    const usageCount = (
      await this.db.query.sessionSecretUsages?.findMany?.({
        where: eq(sessionSecretUsages.secretId, row.id),
      })
    )?.length;

    auditSecretAccess({
      resource: "session_secret",
      action: "decrypt_for_session",
      userId: input.userId,
      sessionId: row.sessionId,
      resourceId: row.id,
      success: true,
    });

    return {
      ...this.toPublicSecret(row),
      usageCount: usageCount ?? 0,
      value,
    };
  }

  async upsertProjectDeployBinding(input: {
    projectId: string;
    environment: string;
    label: string;
    forgegraphKey: string;
    externalRef: string;
    transport: string;
    templateId?: string;
  }) {
    await this.requireOwnedProject(input.projectId);

    const [binding] = await this.db
      .insert(projectDeploySecretBindings)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        environment: input.environment,
        label: input.label,
        forgegraphKey: input.forgegraphKey,
        externalRef: input.externalRef,
        transport: input.transport,
        templateId: input.templateId,
      })
      .onConflictDoUpdate({
        target: [
          projectDeploySecretBindings.projectId,
          projectDeploySecretBindings.environment,
          projectDeploySecretBindings.forgegraphKey,
        ],
        set: {
          label: input.label,
          externalRef: input.externalRef,
          transport: input.transport,
          templateId: input.templateId,
        },
      })
      .returning();

    return binding ?? {
      projectId: input.projectId,
      environment: input.environment,
      label: input.label,
      forgegraphKey: input.forgegraphKey,
      externalRef: input.externalRef,
      transport: input.transport,
      templateId: input.templateId,
    };
  }

  async promoteSessionSecret(input: {
    secretId: string;
    userId: string;
    projectId: string;
    environment: DeployEnvironment;
    forgegraphKey: string;
    adapter: ForgeGraphSecretAdapter;
  }) {
    const secret = await this.getSecretForExecution({
      secretId: input.secretId,
      userId: input.userId,
    });
    await this.requireOwnedProject(input.projectId);

    const promoted = await input.adapter.upsertDeploySecret({
      projectId: input.projectId,
      environment: input.environment,
      key: input.forgegraphKey,
      value: secret.value,
    });

    const [updated] = await this.db
      .update(sessionSecrets)
      .set({
        provider: "forgegraph",
        status: "promoted",
        externalRef: promoted.ref,
        projectId: input.projectId,
      })
      .where(eq(sessionSecrets.id, input.secretId))
      .returning();

    await this.upsertProjectDeployBinding({
      projectId: input.projectId,
      environment: input.environment,
      label: secret.label,
      forgegraphKey: input.forgegraphKey,
      externalRef: promoted.ref,
      transport: secret.transport,
    });

    return this.toPublicSecret(updated ?? {
      ...secret,
      provider: "forgegraph",
      status: "promoted",
      externalRef: promoted.ref,
      projectId: input.projectId,
    });
  }

  private toPublicSecret<T extends Record<string, unknown>>(
    row: T,
  ): Omit<T, "valueCiphertext" | "valueIv" | "valueTag"> {
    const {
      valueCiphertext: _valueCiphertext,
      valueIv: _valueIv,
      valueTag: _valueTag,
      ...publicRow
    } = row;

    return publicRow;
  }
}
