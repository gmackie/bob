import { NextResponse } from "next/server";
import { z } from "zod";

import { getIssueSessionSnapshot } from "~/lib/tasks/kanbangerControl";

import {
  respondWithControlError,
  verifySignedQueryRequest,
} from "../_lib/controlRoute";

const sessionQuerySchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  issueId: z.string().min(1),
  issueIdentifier: z.string().min(1).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    verifySignedQueryRequest(request);

    const url = new URL(request.url);
    const payload = sessionQuerySchema.parse({
      workspaceId: url.searchParams.get("workspaceId"),
      projectId: url.searchParams.get("projectId"),
      issueId: url.searchParams.get("issueId"),
      issueIdentifier: url.searchParams.get("issueIdentifier") ?? undefined,
    });

    const snapshot = await getIssueSessionSnapshot(payload);
    return NextResponse.json(snapshot);
  } catch (error) {
    return respondWithControlError(error);
  }
}
