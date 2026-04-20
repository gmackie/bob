import { ServiceMap } from "effect";
import type { TenantId, TenantMemberRole, UserId } from "@gmacko/validators";

// CurrentUser is populated by auth middleware and consumed by handlers.
// The real shape lives in @gmacko/auth; this file declares the tag only
// to avoid a circular package dep.
export interface CurrentUserShape {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly email: string;
  readonly role: TenantMemberRole;
}

export class CurrentUser extends ServiceMap.Service<
  CurrentUser,
  CurrentUserShape
>()("@gmacko/rpc/CurrentUser") {}
