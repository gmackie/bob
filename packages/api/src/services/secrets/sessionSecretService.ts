import { and, eq } from "@bob/db";
import {
  chatConversations,
  projectDeploySecretBindings,
  projects,
  sessionSecrets,
  sessionSecretUsages,
} from "@bob/db/schema";

import type {
  DeployEnvironment,
  ForgeGraphSecretAdapter,
} from "./forgegraphSecretAdapter";
import {
  decryptSessionSecretValue,
  encryptSessionSecretValue,
} from "../crypto/sessionSecretVault";

interface DatabaseLike {
  query: {
    chatConversations?: {
      findFirst: (args: unknown) => Promise<any>;
    };
    projects?: {
      findFirst: (args: unknown) => Promise<any>;
    };
    sessionSecrets?: {
      findFirst?: (args: unknown) => Promise<any>;
      findMany: (args: unknown) => Promise<any[]>;
    };
    sessionSecretUsages?: {
      findMany?: (args: unknown) => Promise<any[]>;
    };
  };
  insert: (table: unknown) => {
    values: (values: unknown) => {
      returning: () => Promise<any[]>;
      onConflictDoUpdate?: (args: unknown) => {
        returning: () => Promise<any[]>;
      };
    };
  };
  delete: (table: unknown) => {
    where: (where: unknown) => {
      returning: () => Promise<any[]>;
    };
  };
  update: (table: unknown) => {
    set: (values: unknown) => {
      where: (where: unknown) => {
        returning: () => Promise<any[]>;
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
    const session = await this.requireOwnedSession(
      input.sessionId,
      input.userId,
    );
    const id = crypto.randomUUID();
    const encrypted = encryptSessionSecretValue(input.value, id);

    const [created] = await this.db
      .insert(sessionSecrets)
      .values({
        id,
        userId: input.userId,
        sessionId: input.sessionId,
        workspaceId: session.workspaceId ?? null,
        projectId: session.projectId ?? null,
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

    return this.toPublicSecret(
      created ?? {
        id,
        sessionId: input.sessionId,
        label: input.label,
        handle: input.handle,
        transport: input.transport,
        status: "active",
        provider: "bob",
        policy: input.policy,
      },
    );
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

    if (!existing || existing.userId !== input.userId) {
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

    return (
      usage ?? {
        secretId: input.secretId,
        sessionId: input.sessionId,
        executor: input.executor,
        templateId: input.templateId,
      }
    );
  }

  async getSecretForExecution(input: { secretId: string; userId: string }) {
    const row = await this.db.query.sessionSecrets?.findFirst?.({
      where: eq(sessionSecrets.id, input.secretId),
    });

    if (!row || row.userId !== input.userId) {
      throw new Error("Session secret not found");
    }

    const usageCount = (
      await this.db.query.sessionSecretUsages?.findMany?.({
        where: eq(sessionSecretUsages.secretId, row.id),
      })
    )?.length;
    const value = decryptSessionSecretValue(
      {
        ciphertext: row.valueCiphertext,
        iv: row.valueIv,
        tag: row.valueTag,
      },
      row.id,
    );

    await this.auditSecretAccess({
      secretId: row.id,
      sessionId: row.sessionId,
      executor: "user",
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

    if (!row || row.userId !== input.userId) {
      throw new Error("Session secret not found");
    }

    const usageCount = (
      await this.db.query.sessionSecretUsages?.findMany?.({
        where: eq(sessionSecretUsages.secretId, row.id),
      })
    )?.length;
    const value = decryptSessionSecretValue(
      {
        ciphertext: row.valueCiphertext,
        iv: row.valueIv,
        tag: row.valueTag,
      },
      row.id,
    );

    await this.auditSecretAccess({
      secretId: row.id,
      sessionId: row.sessionId,
      executor: "gateway",
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

    const [binding] =
      (await this.db
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
        .onConflictDoUpdate?.({
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
        .returning()) ?? [];

    return (
      binding ?? {
        projectId: input.projectId,
        environment: input.environment,
        label: input.label,
        forgegraphKey: input.forgegraphKey,
        externalRef: input.externalRef,
        transport: input.transport,
        templateId: input.templateId,
      }
    );
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

    return this.toPublicSecret(
      updated ?? {
        ...secret,
        provider: "forgegraph",
        status: "promoted",
        externalRef: promoted.ref,
        projectId: input.projectId,
      },
    );
  }

  private toPublicSecret(row: any) {
    if (!row) return row;

    const {
      valueCiphertext: _valueCiphertext,
      valueIv: _valueIv,
      valueTag: _valueTag,
      ...publicRow
    } = row;

    return publicRow;
  }

  private async auditSecretAccess(input: {
    secretId: string;
    sessionId: string;
    executor: string;
  }) {
    await this.db.insert(sessionSecretUsages).values({
      id: crypto.randomUUID(),
      secretId: input.secretId,
      sessionId: input.sessionId,
      executor: input.executor,
      templateId: "plaintext-access",
    });

    await this.db
      .update(sessionSecrets)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(sessionSecrets.id, input.secretId))
      .returning();
  }
}
