import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { eq, and, desc } from "@bob/db";
import { agentPersonas } from "@bob/db/schema";
import yaml from "js-yaml";
import type { HandlerContext } from "./context.js";

function resolveTenantId(ctx: HandlerContext): string {
  const tid = ctx.tenantId ?? process.env.BOB_TENANT_ID;
  if (!tid) throw new Error("tenantId is required — set BOB_TENANT_ID or pass tenantId in context");
  return tid;
}

export async function personaCreate(
  ctx: HandlerContext,
  input: {
    name: string;
    slug: string;
    description?: string;
    adapterId: string;
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    budgetLimitCents?: number;
    metadata?: Record<string, unknown>;
  },
) {
  const tenantId = resolveTenantId(ctx);
  const [persona] = await ctx.db
    .insert(agentPersonas)
    .values({
      tenantId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      adapterId: input.adapterId,
      model: input.model ?? null,
      systemPrompt: input.systemPrompt ?? null,
      allowedTools: input.allowedTools ?? null,
      autonomyLevel: input.autonomyLevel ?? null,
      budgetLimitCents: input.budgetLimitCents ?? null,
      source: "ui",
      metadata: input.metadata ?? {},
    })
    .returning();
  return persona;
}

export async function personaList(
  ctx: HandlerContext,
  input: { active?: boolean },
) {
  const tenantId = resolveTenantId(ctx);
  const conditions = [eq(agentPersonas.tenantId, tenantId)];
  if (input.active !== undefined) {
    conditions.push(eq(agentPersonas.active, input.active));
  }
  return ctx.db
    .select()
    .from(agentPersonas)
    .where(and(...conditions))
    .orderBy(desc(agentPersonas.createdAt));
}

export async function personaGet(
  ctx: HandlerContext,
  input: { id: string },
) {
  const tenantId = resolveTenantId(ctx);
  const persona = await ctx.db
    .select()
    .from(agentPersonas)
    .where(and(eq(agentPersonas.id, input.id), eq(agentPersonas.tenantId, tenantId)))
    .limit(1);
  return persona[0] ?? null;
}

export async function personaGetBySlug(
  ctx: HandlerContext,
  input: { slug: string },
) {
  const tenantId = resolveTenantId(ctx);
  const [persona] = await ctx.db
    .select()
    .from(agentPersonas)
    .where(
      and(
        eq(agentPersonas.tenantId, tenantId),
        eq(agentPersonas.slug, input.slug),
        eq(agentPersonas.active, true),
      ),
    )
    .limit(1);
  return persona ?? null;
}

export async function personaUpdate(
  ctx: HandlerContext,
  input: {
    id: string;
    name?: string;
    description?: string;
    adapterId?: string;
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    budgetLimitCents?: number;
    metadata?: Record<string, unknown>;
  },
) {
  const tenantId = resolveTenantId(ctx);
  const existing = await ctx.db
    .select()
    .from(agentPersonas)
    .where(and(eq(agentPersonas.id, input.id), eq(agentPersonas.tenantId, tenantId)))
    .limit(1);
  if (!existing[0]) return { found: false as const };
  if (existing[0].source === "repo") return { found: true as const, readOnly: true as const };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.adapterId !== undefined) updates.adapterId = input.adapterId;
  if (input.model !== undefined) updates.model = input.model;
  if (input.systemPrompt !== undefined) updates.systemPrompt = input.systemPrompt;
  if (input.allowedTools !== undefined) updates.allowedTools = input.allowedTools;
  if (input.autonomyLevel !== undefined) updates.autonomyLevel = input.autonomyLevel;
  if (input.budgetLimitCents !== undefined) updates.budgetLimitCents = input.budgetLimitCents;
  if (input.metadata !== undefined) updates.metadata = input.metadata;

  const [updated] = await ctx.db
    .update(agentPersonas)
    .set(updates)
    .where(eq(agentPersonas.id, input.id))
    .returning();
  return { found: true as const, readOnly: false as const, persona: updated };
}

export async function personaDelete(
  ctx: HandlerContext,
  input: { id: string },
) {
  const tenantId = resolveTenantId(ctx);
  const existing = await ctx.db
    .select()
    .from(agentPersonas)
    .where(and(eq(agentPersonas.id, input.id), eq(agentPersonas.tenantId, tenantId)))
    .limit(1);
  if (!existing[0]) return { found: false as const };
  if (existing[0].source === "repo") return { found: true as const, readOnly: true as const };

  await ctx.db
    .update(agentPersonas)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(agentPersonas.id, input.id));
  return { found: true as const, readOnly: false as const };
}

// ---------------------------------------------------------------------------
// Sync from YAML directory
// ---------------------------------------------------------------------------

interface PersonaYaml {
  apiVersion: string;
  name: string;
  slug: string;
  description?: string;
  adapter: string;
  model?: string;
  autonomy_level?: string;
  system_prompt?: string;
  allowed_tools?: string[];
  metadata?: Record<string, unknown>;
}

export async function personaSyncFromDirectory(
  ctx: HandlerContext,
  input: { directory: string },
): Promise<{ created: number; updated: number; unchanged: number }> {
  const tenantId = resolveTenantId(ctx);
  const files = await readdir(input.directory);
  const yamlFiles = files.filter((f) => extname(f) === ".yaml" || extname(f) === ".yml");

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const syncedSlugs: string[] = [];

  for (const file of yamlFiles) {
    const content = await readFile(join(input.directory, file), "utf-8");
    // yaml.load() returns unknown-shaped data (or undefined for an empty
    // file) — this is untrusted external input, so it's narrowed with a
    // real runtime check rather than cast straight to PersonaYaml.
    const raw: unknown = yaml.load(content);
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as Record<string, unknown>).slug !== "string" ||
      typeof (raw as Record<string, unknown>).name !== "string" ||
      typeof (raw as Record<string, unknown>).adapter !== "string"
    ) {
      console.warn(`[persona-sync] Skipping invalid YAML: ${file}`);
      continue;
    }
    const parsed = raw as PersonaYaml;

    syncedSlugs.push(parsed.slug);

    const existing = await ctx.db
      .select()
      .from(agentPersonas)
      .where(
        and(
          eq(agentPersonas.tenantId, tenantId),
          eq(agentPersonas.slug, parsed.slug),
          eq(agentPersonas.source, "repo"),
        ),
      )
      .limit(1);

    const values = {
      tenantId,
      name: parsed.name,
      slug: parsed.slug,
      description: parsed.description ?? null,
      adapterId: parsed.adapter,
      model: parsed.model ?? null,
      systemPrompt: parsed.system_prompt ?? null,
      allowedTools: parsed.allowed_tools ?? null,
      autonomyLevel: parsed.autonomy_level ?? null,
      source: "repo" as const,
      active: true,
      metadata: parsed.metadata ?? {},
      updatedAt: new Date(),
    };

    if (existing[0]) {
      const ex = existing[0];
      const changed =
        ex.name !== values.name ||
        ex.description !== values.description ||
        ex.adapterId !== values.adapterId ||
        ex.model !== values.model ||
        ex.systemPrompt !== values.systemPrompt ||
        JSON.stringify(ex.allowedTools) !== JSON.stringify(values.allowedTools) ||
        ex.autonomyLevel !== values.autonomyLevel ||
        JSON.stringify(ex.metadata) !== JSON.stringify(values.metadata);

      if (changed) {
        await ctx.db
          .update(agentPersonas)
          .set(values)
          .where(eq(agentPersonas.id, ex.id));
        updated++;
      } else {
        unchanged++;
      }
    } else {
      await ctx.db.insert(agentPersonas).values(values);
      created++;
    }
  }

  // Soft-delete repo personas whose slug is no longer in the directory
  const allRepoPersonas = await ctx.db
    .select({ id: agentPersonas.id, slug: agentPersonas.slug })
    .from(agentPersonas)
    .where(
      and(
        eq(agentPersonas.tenantId, tenantId),
        eq(agentPersonas.source, "repo"),
        eq(agentPersonas.active, true),
      ),
    );

  for (const persona of allRepoPersonas) {
    if (!syncedSlugs.includes(persona.slug)) {
      await ctx.db
        .update(agentPersonas)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(agentPersonas.id, persona.id));
    }
  }

  console.log(`[persona-sync] Sync complete: ${created} created, ${updated} updated, ${unchanged} unchanged`);
  return { created, updated, unchanged };
}
