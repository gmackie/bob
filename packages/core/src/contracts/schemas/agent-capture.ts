// Agent Capture schemas — mirrors Bob's capture router
// (packages/bob/src/api/src/router/capture.ts).

import { Schema } from "effect";

// --- Capture Target ---------------------------------------------------------

export const CaptureTargetSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.Literal("browser", "screen", "window"),
  description: Schema.String,
  connected: Schema.Boolean,
});
export type CaptureTargetWire = Schema.Schema.Type<typeof CaptureTargetSchema>;

// --- Capture Result ---------------------------------------------------------

export const CaptureResultSchema = Schema.Struct({
  url: Schema.String,
  filename: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  capturedAt: Schema.String,
});
export type CaptureResultWire = Schema.Schema.Type<typeof CaptureResultSchema>;
