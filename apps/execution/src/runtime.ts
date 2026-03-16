import {
  getExecutionServiceConfig,
  type ExecutionChildProcessConfig,
  type ExecutionServiceConfig,
} from "./config";

export interface ExecutionLogger {
  error(message: string, error?: unknown): void;
  info(message: string): void;
}

export interface ExecutionChild {
  kill(signal?: NodeJS.Signals | number): boolean;
  on(
    event: "error",
    listener: (error: Error) => void,
  ): ExecutionChild;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): ExecutionChild;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): ExecutionChild;
}

export type ExecutionChildFactory = (
  config: ExecutionChildProcessConfig,
) => ExecutionChild;

export const consoleExecutionLogger: ExecutionLogger = {
  info(message) {
    console.log(message);
  },
  error(message, error) {
    console.error(message, error);
  },
};

export function attachChildLifecycle(
  child: ExecutionChild,
  config: ExecutionChildProcessConfig,
  logger: ExecutionLogger,
): void {
  child.on("exit", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    logger.info(`[execution] ${config.name} exited with ${reason}`);
    process.exitCode = code ?? 0;
  });

  child.on("error", (error) => {
    logger.error(`[execution] ${config.name} failed to start`, error);
    process.exitCode = 1;
  });
}

export function createShutdownHandler(
  children: ExecutionChild[],
  logger: ExecutionLogger,
): (signal: NodeJS.Signals) => void {
  return (signal: NodeJS.Signals) => {
    logger.info(`[execution] received ${signal}; forwarding shutdown`);
    for (const child of children) {
      child.kill(signal);
    }
  };
}

export async function waitForChildren(children: ExecutionChild[]): Promise<void> {
  await new Promise<void>((resolve) => {
    let exited = 0;
    for (const child of children) {
      child.once("exit", () => {
        exited += 1;
        if (exited === children.length) {
          resolve();
        }
      });
    }
  });
}

export async function runExecutionService(options?: {
  config?: ExecutionServiceConfig;
  logger?: ExecutionLogger;
  startChild?: ExecutionChildFactory;
}): Promise<void> {
  const config = options?.config ?? getExecutionServiceConfig();
  const logger = options?.logger ?? consoleExecutionLogger;
  const startChild = options?.startChild;
  const children: ExecutionChild[] = [];

  if (config.gateway.enabled) {
    if (!startChild) {
      throw new Error("Execution runtime requires a child factory when gateway is enabled");
    }

    logger.info("[execution] starting gateway child process");
    const child = startChild(config.gateway);
    attachChildLifecycle(child, config.gateway, logger);
    children.push(child);
  } else {
    logger.info("[execution] gateway child process disabled");
  }

  if (children.length === 0) {
    logger.info("[execution] no runtime children enabled; exiting");
    return;
  }

  const shutdown = createShutdownHandler(children, logger);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await waitForChildren(children);
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }
}
