export {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "./errors.js";

export { mapTrpcError } from "./bridge.js";
export type { NotFoundContext, MessageContext, TrpcErrorCode } from "./bridge.js";
