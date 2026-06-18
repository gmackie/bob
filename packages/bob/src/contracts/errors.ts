import { Schema } from "effect";

export class BobNotFoundError extends Schema.TaggedErrorClass<BobNotFoundError>()(
  "BobNotFoundError",
  { entity: Schema.String, id: Schema.String },
) {}

export class BobForbiddenError extends Schema.TaggedErrorClass<BobForbiddenError>()(
  "BobForbiddenError",
  { message: Schema.String },
) {}

export class BobConflictError extends Schema.TaggedErrorClass<BobConflictError>()(
  "BobConflictError",
  { message: Schema.String },
) {}
