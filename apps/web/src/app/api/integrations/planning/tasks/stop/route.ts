import { NextResponse } from "next/server";
import { z } from "zod";

import { stopIssueSession } from "@bob/execution/runtime/planningControl";

import {
  parseSignedJsonRequest,
  respondWithControlError,
} from "../_lib/controlRoute";

const stopIssueSessionSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  issueId: z.string().min(1),
  issueIdentifier: z.string().min(1),
  actor: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    email: z.string().email().optional(),
  }),
  reason: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const { payload } = await parseSignedJsonRequest(
      request,
      stopIssueSessionSchema,
    );
    const snapshot = await stopIssueSession(payload);
    return NextResponse.json(snapshot);
  } catch (error) {
    return respondWithControlError(error);
  }
}
