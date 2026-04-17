import { Schema } from "effect";

export class ThreadNotFoundError extends Schema.TaggedErrorClass()(
  "ThreadNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

export class BranchNotFoundError extends Schema.TaggedErrorClass()(
  "BranchNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

export class AgentError extends Schema.TaggedErrorClass()(
  "AgentError",
  { message: Schema.String },
) {}

export class WikiError extends Schema.TaggedErrorClass()(
  "WikiError",
  { message: Schema.String },
) {}
