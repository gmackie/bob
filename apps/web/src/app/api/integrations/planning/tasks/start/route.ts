import { NextResponse } from "next/server";
import { z } from "zod";

import { startIssueSession } from "@bob/execution/runtime/planningControl";

import {
  parseSignedJsonRequest,
  respondWithControlError,
} from "../_lib/controlRoute";

const startIssueSessionSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  issueId: z.string().min(1),
  issueIdentifier: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
  actor: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    email: z.string().email().optional(),
  }),
  repository: z
    .object({
      id: z.string().optional(),
      fullName: z.string().optional(),
      url: z.string().url().optional(),
      defaultBranch: z.string().optional(),
    })
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const { payload } = await parseSignedJsonRequest(
      request,
      startIssueSessionSchema,
    );
    const snapshot = await startIssueSession(payload);
    return NextResponse.json(snapshot);
  } catch (error) {
    return respondWithControlError(error);
  }
}
