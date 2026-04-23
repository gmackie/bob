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

// RunnerSession is populated by `RunnerSessionMiddleware` in `@gmacko/auth`
// for runner-protocol procedures. Sibling of `CurrentUser`: declared here
// so runner-protocol handlers can depend on it without pulling
// `@gmacko/auth` into the RPC contract surface.
//
// `deviceId` / `tenantId` are plain strings on the wire (runner devices
// are UUIDs but we keep the tag schema-agnostic at this layer — the
// protocol package owns the branded types). The session token itself
// encodes + signs this shape; the middleware verifies + provides it.
export interface RunnerSessionShape {
  readonly deviceId: string;
  readonly tenantId: string;
}

export class RunnerSession extends ServiceMap.Service<
  RunnerSession,
  RunnerSessionShape
>()("@gmacko/rpc/RunnerSession") {}
