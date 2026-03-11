import { resolve } from "node:path";

export interface ExecutionChildProcessConfig {
  args: string[];
  command: string;
  cwd: string;
  enabled: boolean;
  name: string;
}

export interface ExecutionServiceConfig {
  gateway: ExecutionChildProcessConfig;
}

const ROOT_DIR = resolve(import.meta.dirname, "../../..");

function isEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  return value !== "0" && value.toLowerCase() !== "false";
}

function getGatewayCommand(): string[] {
  const lifecycle = process.env.NODE_ENV === "production" ? "start" : "dev";
  return ["--filter", "@bob/gateway", lifecycle];
}

export function getExecutionServiceConfig(): ExecutionServiceConfig {
  return {
    gateway: {
      name: "gateway",
      enabled: isEnabled(process.env.BOB_EXECUTION_ENABLE_GATEWAY, true),
      command: process.env.BOB_EXECUTION_GATEWAY_BIN ?? "pnpm",
      args: getGatewayCommand(),
      cwd: ROOT_DIR,
    },
  };
}
