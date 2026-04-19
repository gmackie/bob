import { ServiceMap } from "effect";

// CurrentUser is populated by auth middleware and consumed by handlers.
// The real shape lives in @gmacko/auth; this file declares the tag only
// to avoid a circular package dep.
export interface CurrentUserShape {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
}

export class CurrentUser extends ServiceMap.Service<
  CurrentUser,
  CurrentUserShape
>()("@gmacko/rpc/CurrentUser") {}
