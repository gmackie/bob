import { redirect } from "next/navigation";
import { db } from "@bob/db/client";
import { eq } from "@bob/db";
import { deviceCodes } from "@bob/db/schema";
import { getSession } from "~/auth/server";
import { DeviceApprovalClient } from "./client";

export const dynamic = "force-dynamic";

export default async function DeviceApprovalPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const session = await getSession();
  if (!session) {
    redirect(`/login?callbackUrl=/device/${encodeURIComponent(code)}`);
  }

  const [record] = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.userCode, code))
    .limit(1);

  if (!record || record.status !== "pending") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Invalid Code
          </h1>
          <p className="text-sm text-muted-foreground">
            This device code is invalid or has already been used.
          </p>
        </div>
      </main>
    );
  }

  if (new Date(record.expiresAt) < new Date()) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Code Expired
          </h1>
          <p className="text-sm text-muted-foreground">
            This device code has expired. Please run the login command again to
            generate a new code.
          </p>
        </div>
      </main>
    );
  }

  return <DeviceApprovalClient userCode={code} />;
}
