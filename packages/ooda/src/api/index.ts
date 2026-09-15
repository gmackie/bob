import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root";
export { type EdgeRouter, edgeRouter } from "./edge-router";
export { createTRPCContext } from "./trpc";
export {
  createConversationEventStreamResponse,
  encodeConversationEventSse,
  resolveAfterSequence,
} from "./conversation-event-stream";
export {
  createTtsGrantHttpResponse,
  createTtsStreamHttpResponse,
} from "./tts-http";
// OpenAI-compatible surface (/v1/chat/completions, /v1/models). The edge app's
// route handlers are thin wrappers over these; PlayTrek and anything else that
// speaks the OpenAI API can point at Bob without client changes.
export {
  completeOodaOpenAiChat,
  extractBearerToken,
  listOodaOpenAiModels,
  OODA_OPENAI_CORS_HEADERS,
  OodaOpenAiError,
  oodaOpenAiErrorResponse,
  oodaOpenAiOptionsResponse,
  withOodaOpenAiCors,
} from "./openai-compat";
export type {
  OodaOpenAiDevice,
  OodaOpenAiDispatch,
  OodaOpenAiEvent,
  OodaOpenAiSession,
} from "./openai-compat";
export type { RouterInputs, RouterOutputs };
