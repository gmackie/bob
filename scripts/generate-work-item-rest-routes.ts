import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { workItemsRestOperations } from "../packages/api/src/contracts/work-items-rest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function routeFileContents(operationName: string) {
  return `import { createWorkItemRouteHandler } from "~/lib/rest/work-item-route-handler";

export const runtime = "nodejs";
export const POST = createWorkItemRouteHandler(${JSON.stringify(operationName)});
`;
}

async function main() {
  for (const operation of workItemsRestOperations) {
    const relativeDir = operation.restPath.replace(/^\/api\//, "apps/web/src/app/api/");
    const outputDir = path.join(repoRoot, relativeDir);

    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, "route.ts"),
      routeFileContents(operation.procedureName),
      "utf8",
    );
  }
}

void main();
