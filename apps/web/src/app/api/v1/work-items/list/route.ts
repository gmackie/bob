import { createWorkItemRouteHandler } from "~/lib/rest/work-item-route-handler";

export const runtime = "nodejs";
export const POST = createWorkItemRouteHandler("list");
