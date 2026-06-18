import { auth } from "~/auth/server";

export const GET = (request: Request) => auth.handler(request);

export const POST = (request: Request) => auth.handler(request);
