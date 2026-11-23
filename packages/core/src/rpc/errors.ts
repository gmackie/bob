import { Schema } from "effect";

export class RpcError extends Schema.TaggedError<RpcError>()("RpcError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String },
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { entity: Schema.String, id: Schema.String },
) {}
