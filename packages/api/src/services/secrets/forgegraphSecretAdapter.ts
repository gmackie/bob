import { requireForgeGraphClient } from "../forgegraph/config";

type DeployEnvironment = "dev" | "staging" | "prod" | "preview";

export class ForgeGraphSecretAdapter {
  async upsertDeploySecret(input: {
    projectId: string;
    environment: DeployEnvironment;
    key: string;
    value: string;
  }) {
    const client = requireForgeGraphClient();
    return client.upsertDeploySecret(input);
  }

  async listDeploySecrets(input: {
    projectId: string;
    environment?: DeployEnvironment;
  }) {
    const client = requireForgeGraphClient();
    return client.listDeploySecrets(input);
  }
}

export type { DeployEnvironment };
