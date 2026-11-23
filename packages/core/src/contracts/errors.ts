import { Schema } from "effect";

export class ThreadNotFoundError extends Schema.TaggedError<ThreadNotFoundError>()(
  "ThreadNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

export class BranchNotFoundError extends Schema.TaggedError<BranchNotFoundError>()(
  "BranchNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

export class AgentError extends Schema.TaggedError<AgentError>()(
  "AgentError",
  { message: Schema.String },
) {}

export class WikiError extends Schema.TaggedError<WikiError>()(
  "WikiError",
  { message: Schema.String },
) {}

export class ExplorationError extends Schema.TaggedError<ExplorationError>()(
  "ExplorationError",
  { message: Schema.String },
) {}
