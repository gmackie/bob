import { Schema } from "effect";

export const WikiArticle = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
  outboundLinks: Schema.Array(Schema.String),
});
export type WikiArticle = typeof WikiArticle.Type;

export const SynthesizeInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isUUID()),
  branchId: Schema.String.check(Schema.isUUID()),
  title: Schema.String.check(Schema.isMinLength(1)),
  tags: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});

export const SynthesizeResult = Schema.Struct({
  filePath: Schema.String,
  slug: Schema.String,
  title: Schema.String,
});
