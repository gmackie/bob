import type { ProblemV1 } from "../contracts/v1";

export type OodaKernelProblemCode =
  | "BAD_CURSOR"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "HOST_TURN_IN_PROGRESS"
  | "CONTEXT_DISCLOSURE_DENIED"
  | "TTS_DISCLOSURE_DENIED"
  | "TTS_GRANT_UNAVAILABLE"
  | "VALIDATION_FAILED";

const titles: Record<OodaKernelProblemCode, string> = {
  BAD_CURSOR: "Invalid cursor",
  CONFLICT: "Conflict",
  IDEMPOTENCY_CONFLICT: "Idempotency conflict",
  NOT_FOUND: "Not found",
  HOST_TURN_IN_PROGRESS: "Host turn in progress",
  CONTEXT_DISCLOSURE_DENIED: "Context disclosure denied",
  TTS_DISCLOSURE_DENIED: "Text-to-speech disclosure denied",
  TTS_GRANT_UNAVAILABLE: "Text-to-speech grant unavailable",
  VALIDATION_FAILED: "Validation failed",
};

export class OodaKernelProblem extends Error {
  constructor(
    readonly code: OodaKernelProblemCode,
    readonly status: 400 | 403 | 404 | 409 | 410 | 422,
    message: string,
  ) {
    super(message);
    this.name = "OodaKernelProblem";
  }

  toProblem(correlationId: string, instance?: string): ProblemV1 {
    return {
      version: "v1",
      type: `https://ooda.local/problems/${this.code.toLowerCase().replaceAll("_", "-")}`,
      title: titles[this.code],
      status: this.status,
      code: this.code,
      detail: this.message,
      correlationId,
      ...(instance ? { instance } : {}),
    };
  }
}

export function notFound(resource: string): OodaKernelProblem {
  return new OodaKernelProblem("NOT_FOUND", 404, `${resource} was not found`);
}

export function idempotencyConflict(): OodaKernelProblem {
  return new OodaKernelProblem(
    "IDEMPOTENCY_CONFLICT",
    409,
    "The idempotency key was already used with different input",
  );
}
