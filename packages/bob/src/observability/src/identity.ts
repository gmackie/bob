export interface UserIdentity {
  userId: string;
  email?: string;
  name?: string;
}

export interface TenantIdentity {
  tenantId: string;
  tenantSlug?: string;
  workspaceId?: string;
}

export interface IdentityContext {
  user?: UserIdentity;
  tenant?: TenantIdentity;
}

export function buildIdentityTags(context: IdentityContext): Record<string, string> {
  const tags: Record<string, string> = {};
  if (context.user?.userId) tags.user_id = context.user.userId;
  if (context.user?.email) tags.user_email = context.user.email;
  if (context.tenant?.tenantId) tags.tenant_id = context.tenant.tenantId;
  if (context.tenant?.tenantSlug) tags.tenant_slug = context.tenant.tenantSlug;
  if (context.tenant?.workspaceId) tags.workspace_id = context.tenant.workspaceId;
  return tags;
}

export function buildIdentityProperties(
  context: IdentityContext,
): Record<string, string> {
  return buildIdentityTags(context);
}

export function buildDistinctId(context: IdentityContext): string | undefined {
  return context.user?.userId ?? context.tenant?.tenantId;
}
