import { Schema } from "effect";

export class BobNotFoundError extends Schema.TaggedError<BobNotFoundError>()(
  "BobNotFoundError",
  { entity: Schema.String, id: Schema.String },
) {}

export class BobForbiddenError extends Schema.TaggedError<BobForbiddenError>()(
  "BobForbiddenError",
  { message: Schema.String },
) {}

export class BobConflictError extends Schema.TaggedError<BobConflictError>()(
  "BobConflictError",
  { message: Schema.String },
) {}
