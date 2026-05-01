import { randomUUID } from "node:crypto";

export interface ComparisonChild {
  id: string;
  adapterId: string;
  comparisonId: string;
}

export interface ComparisonResult {
  exitCode: number;
  output: string;
}

export interface ComparisonError {
  error: string;
}

export type ComparisonStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed";

export interface ComparisonInput {
  threadId: string;
  adapterIds: string[];
  toolProfileId: string;
  sourceBundleIds: string[];
  workspaceRoot: string;
  prompt: string;
}

export class ComparisonSession {
  public readonly comparisonId: string;
  public readonly threadId: string;
  public readonly sessions: ComparisonChild[];
  public readonly results = new Map<string, ComparisonResult>();
  public readonly errors = new Map<string, ComparisonError>();
  public readonly prompt: string;

  private constructor(input: ComparisonInput) {
    this.comparisonId = randomUUID();
    this.threadId = input.threadId;
    this.prompt = input.prompt;
    this.sessions = input.adapterIds.map((adapterId) => ({
      id: randomUUID(),
      adapterId,
      comparisonId: this.comparisonId,
    }));
  }

  static create(input: ComparisonInput): ComparisonSession {
    if (input.adapterIds.length < 2) {
      throw new Error("Comparison requires at least 2 adapters");
    }
    return new ComparisonSession(input);
  }

  get status(): ComparisonStatus {
    const totalSessions = this.sessions.length;
    const completedCount = this.results.size;
    const failedCount = this.errors.size;
    const finishedCount = completedCount + failedCount;

    if (finishedCount === 0) return "pending";
    if (finishedCount < totalSessions) return "running";
    if (failedCount === totalSessions) return "failed";
    if (failedCount > 0) return "partial";
    return "completed";
  }

  markSessionCompleted(sessionId: string, result: ComparisonResult): void {
    this.results.set(sessionId, result);
  }

  markSessionFailed(sessionId: string, error: ComparisonError): void {
    this.errors.set(sessionId, error);
  }
}
