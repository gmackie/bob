export type ExecutionRuntimeKind = "service" | "session" | "validation";

export interface ExecutionTargetRef {
  id: string;
  runtime: ExecutionRuntimeKind;
}

export interface ExecutionBackendRef {
  id: string;
  kind: "bob";
}
