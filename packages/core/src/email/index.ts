// @gmacko/email — Phase 6L peripheral package stub.
//
// Public surface:
//   - `Email` — Effect service with `send(message)` (transactional email).
//   - `layerEmailStub` — Layer that fails every method with `EmailNotImplementedError`.
//   - Tagged error: `EmailNotImplementedError`.
//   - Types: `EmailMessage`, `EmailAttachment`, `EmailShape`.
//
// Real implementation deferred to Phase 7 (Bob migration). Drivers (SES,
// Resend, SMTP) will land per concrete consumer needs.
import { Effect, Layer, Schema, ServiceMap } from "effect";

export interface EmailAttachment {
  readonly filename: string;
  readonly content: ArrayBuffer | Uint8Array | string;
  readonly contentType?: string;
}

export interface EmailMessage {
  readonly to: string | readonly string[];
  readonly from?: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly replyTo?: string;
  readonly attachments?: readonly EmailAttachment[];
}

export class EmailNotImplementedError extends Schema.TaggedErrorClass<EmailNotImplementedError>()(
  "EmailNotImplementedError",
  {
    reason: Schema.String,
    to: Schema.optional(Schema.String),
  },
) {}

export interface EmailShape {
  readonly send: (
    message: EmailMessage,
  ) => Effect.Effect<{ messageId: string }, EmailNotImplementedError>;
}

export const Email = ServiceMap.Service<EmailShape>("@gmacko/email/Email");

const reason = "@gmacko/email: deferred to Phase 7 (Bob migration)";

const recipientToString = (to: EmailMessage["to"]): string =>
  Array.isArray(to) ? to.join(",") : (to as string);

export const layerEmailStub: Layer.Layer<EmailShape> = Layer.succeed(Email, {
  send: (message) =>
    Effect.fail(
      new EmailNotImplementedError({
        reason,
        to: recipientToString(message.to),
      }),
    ),
});

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoEmailPhase = "6l" as const;
