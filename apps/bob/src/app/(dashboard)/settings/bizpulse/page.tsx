import { redirect } from "next/navigation";

import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { bizpulseMcpLink, workspaces } from "@bob/db/schema";

import { getSession } from "~/auth/server";
import { bizpulseConfig } from "~/server/bizpulse/client";

export default async function BizPulseSettings({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getSession();
  if (!session?.session || session.session.expiresAt <= new Date())
    redirect("/login");
  const config = bizpulseConfig();
  const { status } = await searchParams;
  const rows = config
    ? await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          link: bizpulseMcpLink.id,
        })
        .from(workspaces)
        .leftJoin(
          bizpulseMcpLink,
          and(
            eq(bizpulseMcpLink.workspaceId, workspaces.id),
            eq(bizpulseMcpLink.userId, session.user.id),
            eq(bizpulseMcpLink.origin, config.origin),
          ),
        )
        .where(eq(workspaces.ownerUserId, session.user.id))
    : [];
  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <h1 className="text-2xl font-semibold">BizPulse connection</h1>
      <p>
        Choose a Bob workspace, then select the startups Bob can access in
        BizPulse.
      </p>
      {status === "failed" && (
        <p role="alert">
          The connection could not be updated. Check BizPulse access and try
          again.
        </p>
      )}
      {status === "connected" && <p role="status">BizPulse connected.</p>}
      {status === "disconnected" && <p role="status">BizPulse disconnected.</p>}
      {!config && <p>BizPulse connection is currently disabled.</p>}
      {config && rows.length === 0 && <p>No Bob workspaces you own.</p>}
      {rows.map((row) => (
        <section key={row.id} className="space-y-2 rounded border p-4">
          <h2 className="font-semibold">{row.name}</h2>
          <form
            method="post"
            action={
              row.link ? "/api/bizpulse/disconnect" : "/api/bizpulse/connect"
            }
          >
            <input type="hidden" name="workspace" value={row.id} />
            <button type="submit" className="rounded border px-3 py-1">
              {row.link ? "Disconnect BizPulse" : "Connect BizPulse"}
            </button>
          </form>
        </section>
      ))}
    </main>
  );
}
