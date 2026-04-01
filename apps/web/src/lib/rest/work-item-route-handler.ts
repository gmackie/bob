import { NextResponse } from "next/server";
import { workItemsRestOperations } from "@bob/api/contracts/work-items-rest";

import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

const operationByName = new Map(
  workItemsRestOperations.map((operation) => [
    operation.procedureName,
    operation,
  ]),
);

export function createWorkItemRouteHandler(
  operationName: (typeof workItemsRestOperations)[number]["procedureName"],
) {
  const operation = operationByName.get(operationName);

  if (!operation) {
    throw new Error(`Unknown work item REST operation: ${operationName}`);
  }

  return async function POST(request: Request) {
    try {
      const caller = (await createPublicApiCaller(request)) as any;
      const body = await request.json();
      const result = await caller.workItems[operation.procedureName](body);
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
