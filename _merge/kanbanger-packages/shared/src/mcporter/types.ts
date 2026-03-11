export type McporterCommandSpec = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type McporterTruncation = {
  stdout: boolean;
  stderr: boolean;
};

export type McporterRunResult = {
  requestId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: McporterTruncation;
};

export type McporterPolicy = {
  allowedCommands: string[];
  maxTimeoutMs: number;
  maxOutputBytes: number;
};

export type McporterPolicyErrorCode =
  | "NOT_ALLOWED"
  | "INVALID_INPUT"
  | "TIMEOUT_TOO_HIGH"
  | "OUTPUT_LIMIT_TOO_HIGH";

export type McporterPolicyError = {
  code: McporterPolicyErrorCode;
  message: string;
  details?: Record<string, unknown>;
};
