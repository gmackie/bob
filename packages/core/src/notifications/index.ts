// @gmacko/notifications — Phase 6L peripheral package stub.
//
// Public surface:
//   - `Notifications` — Effect service with `send(payload)` across email/push/toast/sms.
//   - `layerNotificationsStub` — Layer that fails every method with `NotificationsNotImplementedError`.
//   - Tagged error: `NotificationsNotImplementedError`.
//   - Types: `NotificationChannel`, `NotificationPayload`, `NotificationsShape`.
//
// Real implementation deferred to Phase 7 (Bob migration). Consumers can wire
// the type-safe service contract today; the runtime swap is per-method later.
import { Effect, Layer, Schema, ServiceMap } from "effect";

export type NotificationChannel = "email" | "push" | "toast" | "sms";

export interface NotificationPayload {
  readonly channel: NotificationChannel;
  readonly recipient: string;
  readonly subject?: string;
  readonly body: string;
  readonly metadata?: Record<string, unknown>;
}

export class NotificationsNotImplementedError extends Schema.TaggedErrorClass<NotificationsNotImplementedError>()(
  "NotificationsNotImplementedError",
  {
    reason: Schema.String,
    channel: Schema.optional(Schema.String),
  },
) {}

export interface NotificationsShape {
  readonly send: (
    input: NotificationPayload,
  ) => Effect.Effect<void, NotificationsNotImplementedError>;
}

export const Notifications = ServiceMap.Service<NotificationsShape>(
  "@gmacko/notifications/Notifications",
);

const reason =
  "@gmacko/notifications: deferred to Phase 7 (Bob migration)";

export const layerNotificationsStub: Layer.Layer<NotificationsShape> =
  Layer.succeed(Notifications, {
    send: (input) =>
      Effect.fail(
        new NotificationsNotImplementedError({
          reason,
          channel: input.channel,
        }),
      ),
  });

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoNotificationsPhase = "6l" as const;
