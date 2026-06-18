import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import {
  sessionSecrets,
  sessionSecretUsages,
  projectDeploySecretBindings,
} from "../secrets.js";
import { projects } from "../projects.js";
import { tenants } from "../tenancy.js";

describe("@gmacko/db secrets schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  async function seedProject(opts: {
    tenantId: string;
    slug: string;
    name: string;
  }) {
    const [project] = await ctx.db
      .insert(projects)
      .values({
        tenantId: opts.tenantId,
        slug: opts.slug,
        name: opts.name,
      })
      .returning();
    return project!;
  }

  it("session_secrets: insert + query by (tenantId, name)", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Acme", slug: "acme" })
      .returning();

    await ctx.db.insert(sessionSecrets).values({
      tenantId: tenant!.id,
      name: "GITHUB_TOKEN",
      ciphertext: "base64-ciphertext",
      iv: "base64-iv",
      authTag: "base64-tag",
      policy: {
        allowedTemplates: ["git-clone"],
        allowedArgPrefixes: { "git-clone": ["https://github.com/"] },
        maxUses: 10,
        redactOutput: true,
      },
      usesRemaining: 10,
    });

    const found = await ctx.db.query.sessionSecrets.findFirst({
      where: and(
        eq(sessionSecrets.tenantId, tenant!.id),
        eq(sessionSecrets.name, "GITHUB_TOKEN"),
      ),
    });
    expect(found).toBeDefined();
    expect(found?.ciphertext).toBe("base64-ciphertext");
    expect(found?.iv).toBe("base64-iv");
    expect(found?.authTag).toBe("base64-tag");
    expect(found?.usesRemaining).toBe(10);
    expect(found?.policy).toEqual({
      allowedTemplates: ["git-clone"],
      allowedArgPrefixes: { "git-clone": ["https://github.com/"] },
      maxUses: 10,
      redactOutput: true,
    });
  });

  it("session_secrets: (tenantId, name) uniqueness enforced", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Dup Inc", slug: "dup" })
      .returning();

    await ctx.db.insert(sessionSecrets).values({
      tenantId: tenant!.id,
      name: "AWS_KEY",
      ciphertext: "ct1",
      iv: "iv1",
      authTag: "tag1",
    });

    await expect(
      ctx.db.insert(sessionSecrets).values({
        tenantId: tenant!.id,
        name: "AWS_KEY",
        ciphertext: "ct2",
        iv: "iv2",
        authTag: "tag2",
      }),
    ).rejects.toThrow();
  });

  it("session_secret_usages: insert + query by secretId", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Usage Co", slug: "usage" })
      .returning();
    const [secret] = await ctx.db
      .insert(sessionSecrets)
      .values({
        tenantId: tenant!.id,
        name: "OPENAI_KEY",
        ciphertext: "ct",
        iv: "iv",
        authTag: "tag",
      })
      .returning();

    const sessionId = "00000000-0000-0000-0000-000000000001";
    await ctx.db.insert(sessionSecretUsages).values({
      secretId: secret!.id,
      sessionId,
      templateId: "run-python",
      commandPrefix: "python script.py",
      success: true,
    });
    await ctx.db.insert(sessionSecretUsages).values({
      secretId: secret!.id,
      sessionId,
      templateId: "run-python",
      commandPrefix: "python other.py",
      success: false,
    });

    const usages = await ctx.db.query.sessionSecretUsages.findMany({
      where: eq(sessionSecretUsages.secretId, secret!.id),
    });
    expect(usages).toHaveLength(2);
    const successes = usages.filter((u) => u.success);
    expect(successes).toHaveLength(1);
    expect(usages[0]?.templateId).toBe("run-python");
  });

  it("session_secret_usages: cascade on secret delete", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Cascade LLC", slug: "cascade" })
      .returning();
    const [secret] = await ctx.db
      .insert(sessionSecrets)
      .values({
        tenantId: tenant!.id,
        name: "DB_PASSWORD",
        ciphertext: "ct",
        iv: "iv",
        authTag: "tag",
      })
      .returning();

    await ctx.db.insert(sessionSecretUsages).values({
      secretId: secret!.id,
      templateId: "migrate",
      commandPrefix: "psql",
    });

    await ctx.db
      .delete(sessionSecrets)
      .where(eq(sessionSecrets.id, secret!.id));

    const remaining = await ctx.db.query.sessionSecretUsages.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("project_deploy_secret_bindings: insert + query by (tenantId, projectId)", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Deploy Co", slug: "deploy" })
      .returning();
    const bobProject = await seedProject({
      tenantId: tenant!.id,
      slug: "bob-web",
      name: "Bob Web",
    });
    const oodaProject = await seedProject({
      tenantId: tenant!.id,
      slug: "ooda-api",
      name: "OODA API",
    });
    const [dbSecret] = await ctx.db
      .insert(sessionSecrets)
      .values({
        tenantId: tenant!.id,
        name: "PROD_DB_URL",
        ciphertext: "ct1",
        iv: "iv1",
        authTag: "tag1",
      })
      .returning();
    const [ghSecret] = await ctx.db
      .insert(sessionSecrets)
      .values({
        tenantId: tenant!.id,
        name: "GITHUB_TOKEN",
        ciphertext: "ct2",
        iv: "iv2",
        authTag: "tag2",
      })
      .returning();

    await ctx.db.insert(projectDeploySecretBindings).values({
      tenantId: tenant!.id,
      secretId: dbSecret!.id,
      projectId: bobProject.id,
      deployEnvironment: "production",
      deployEnvVarName: "DATABASE_URL",
    });
    await ctx.db.insert(projectDeploySecretBindings).values({
      tenantId: tenant!.id,
      secretId: ghSecret!.id,
      projectId: bobProject.id,
      deployEnvironment: "production",
      deployEnvVarName: "GITHUB_TOKEN",
    });
    // Different project — should be independent
    await ctx.db.insert(projectDeploySecretBindings).values({
      tenantId: tenant!.id,
      secretId: dbSecret!.id,
      projectId: oodaProject.id,
      deployEnvironment: "production",
      deployEnvVarName: "DATABASE_URL",
    });

    const bobBindings = await ctx.db.query.projectDeploySecretBindings.findMany(
      {
        where: and(
          eq(projectDeploySecretBindings.tenantId, tenant!.id),
          eq(projectDeploySecretBindings.projectId, bobProject.id),
        ),
      },
    );
    expect(bobBindings).toHaveLength(2);
    const envVarNames = bobBindings.map((b) => b.deployEnvVarName).sort();
    expect(envVarNames).toEqual(["DATABASE_URL", "GITHUB_TOKEN"]);

    // Uniqueness: same (tenant, projectId, env, envVarName) should fail
    await expect(
      ctx.db.insert(projectDeploySecretBindings).values({
        tenantId: tenant!.id,
        secretId: ghSecret!.id,
        projectId: bobProject.id,
        deployEnvironment: "production",
        deployEnvVarName: "DATABASE_URL",
      }),
    ).rejects.toThrow();
  });

  it("project_deploy_secret_bindings: cascade on project delete", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Cascade Project Co", slug: "cascade-project" })
      .returning();
    const project = await seedProject({
      tenantId: tenant!.id,
      slug: "project-to-delete",
      name: "Project to Delete",
    });
    const [secret] = await ctx.db
      .insert(sessionSecrets)
      .values({
        tenantId: tenant!.id,
        name: "ENV_SECRET",
        ciphertext: "ct",
        iv: "iv",
        authTag: "tag",
      })
      .returning();

    await ctx.db.insert(projectDeploySecretBindings).values({
      tenantId: tenant!.id,
      secretId: secret!.id,
      projectId: project.id,
      deployEnvironment: "production",
      deployEnvVarName: "ENV_SECRET",
    });

    // Sanity: binding exists
    const before = await ctx.db.query.projectDeploySecretBindings.findMany({
      where: eq(projectDeploySecretBindings.projectId, project.id),
    });
    expect(before).toHaveLength(1);

    // Delete the project — binding should cascade away.
    await ctx.db.delete(projects).where(eq(projects.id, project.id));

    const after = await ctx.db.query.projectDeploySecretBindings.findMany({
      where: eq(projectDeploySecretBindings.projectId, project.id),
    });
    expect(after).toHaveLength(0);

    // The underlying secret row should still exist — cascade is project-scoped.
    const secretAfter = await ctx.db.query.sessionSecrets.findFirst({
      where: eq(sessionSecrets.id, secret!.id),
    });
    expect(secretAfter).toBeDefined();
  });

  it("project_deploy_secret_bindings: unique (tenantId, projectId, deployEnvironment, deployEnvVarName)", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Unique Binding Co", slug: "unique-binding" })
      .returning();
    const project = await seedProject({
      tenantId: tenant!.id,
      slug: "unique-binding-project",
      name: "Unique Binding Project",
    });
    const [secretA] = await ctx.db
      .insert(sessionSecrets)
      .values({
        tenantId: tenant!.id,
        name: "SECRET_A",
        ciphertext: "ctA",
        iv: "ivA",
        authTag: "tagA",
      })
      .returning();
    const [secretB] = await ctx.db
      .insert(sessionSecrets)
      .values({
        tenantId: tenant!.id,
        name: "SECRET_B",
        ciphertext: "ctB",
        iv: "ivB",
        authTag: "tagB",
      })
      .returning();

    await ctx.db.insert(projectDeploySecretBindings).values({
      tenantId: tenant!.id,
      secretId: secretA!.id,
      projectId: project.id,
      deployEnvironment: "production",
      deployEnvVarName: "SHARED_ENV_VAR",
    });

    // A second binding with the same 4-tuple — even pointing at a different
    // secret — must violate the unique constraint.
    await expect(
      ctx.db.insert(projectDeploySecretBindings).values({
        tenantId: tenant!.id,
        secretId: secretB!.id,
        projectId: project.id,
        deployEnvironment: "production",
        deployEnvVarName: "SHARED_ENV_VAR",
      }),
    ).rejects.toThrow();
  });
});
