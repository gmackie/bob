import { hostname } from "node:os";

import { loadConfig } from "./config";
import { createDeliveryAdapters } from "./integrations/delivery-adapters";
import { IntegrationOnlyRunner } from "./integrations/integration-only-runner";
import { createRunnerTRPCClient } from "./trpc-client";

async function main(): Promise<void> {
  if (!process.env.OODA_RUNNER_SECRET?.trim()) {
    throw new Error(
      "OODA_RUNNER_SECRET is required for the integration-only runner",
    );
  }

  const config = loadConfig();
  const adapters = createDeliveryAdapters(config);
  const trpc = createRunnerTRPCClient(config.serverUrl);
  const runner = new IntegrationOnlyRunner({
    runnerName: config.runnerName,
    hostname: hostname(),
    adapters,
    api: {
      register: (input) => trpc.runner.register.mutate(input),
      heartbeat: (input) => trpc.runner.heartbeat.mutate(input),
      claim: (input) => trpc.integrations.claim.mutate(input),
      complete: (input) => trpc.integrations.complete.mutate(input),
      fail: (input) => trpc.integrations.fail.mutate(input),
      claimStatus: (input) => trpc.integrations.claimStatus.mutate(input),
      completeStatus: (input) => trpc.integrations.completeStatus.mutate(input),
      failStatus: (input) => trpc.integrations.failStatus.mutate(input),
    },
  });

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await runner.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());

  await runner.start();
  console.log(
    `[integration-runner] healthy (${[...adapters.keys()].sort().join(", ")})`,
  );
}

void main().catch((error) => {
  console.error(
    "[integration-runner] fatal:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
