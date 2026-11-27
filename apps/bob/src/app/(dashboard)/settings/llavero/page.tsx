import { redirect } from "next/navigation";

import { and, eq, isNotNull } from "@bob/db";
import { db } from "@bob/db/client";
import { llaveroMcpLink, workspaces } from "@bob/db/schema";

import { getSession } from "~/auth/server";
import { llaveroConfig } from "~/server/llavero/client";

const feedback = {
  connected: "Llavero connected. Bob can reach the rotation tools.",
  verified: "Bob’s Llavero rotation permissions are active.",
  disconnected: "Llavero disconnected.",
  failed: "Bob could not verify access to Llavero’s rotation tools. Check the project grant and reconnect.",
  "revocation-required": "Disconnected in Bob. Revoke the grant in Llavero’s Agent access settings.",
};

const feedbackMessage = (status?: string) =>
  Object.entries(feedback).find(([key]) => key === status)?.[1];

export default async function LlaveroSettings({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getSession();
  if (!session?.session || session.session.expiresAt <= new Date()) redirect("/login");
  const config = llaveroConfig();
  const { status } = await searchParams;
  const message = feedbackMessage(status);
  const rows = config
    ? await db.select({
        id: workspaces.id,
        name: workspaces.name,
        connected: llaveroMcpLink.id,
        expiresAt: llaveroMcpLink.expiresAt,
      })
      .from(workspaces)
      .leftJoin(llaveroMcpLink, and(
        eq(llaveroMcpLink.workspaceId, workspaces.id),
        eq(llaveroMcpLink.userId, session.user.id),
        eq(llaveroMcpLink.origin, config.origin),
        isNotNull(llaveroMcpLink.tokens),
      ))
      .where(eq(workspaces.ownerUserId, session.user.id))
    : [];

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Llavero connection</h1>
      <p>Choose a Bob workspace, then grant rotation read and proposal access to the intended project in Llavero. The Llavero owner approves credential changes.</p>
      {message && <p role="status">{message}</p>}
      {!config && <p>Llavero connection is currently disabled.</p>}
      {config && rows.length === 0 && <p>No Bob workspaces you own.</p>}
      {rows.map((row) => (
        <section key={row.id} className="space-y-2 rounded border p-4">
          <h2 className="font-semibold">{row.name}</h2>
          {row.connected && !row.expiresAt && <p>Disconnect and reconnect to renew access.</p>}
          <form method="post" className="flex flex-wrap gap-2">
            <input type="hidden" name="workspace" value={row.id} />
            {row.connected && row.expiresAt && (
              <button type="submit" formAction="/api/llavero/check" className="rounded border px-3 py-1">
                Check access
              </button>
            )}
            <button
              type="submit"
              formAction={row.connected ? "/api/llavero/disconnect" : "/api/llavero/connect"}
              className="rounded border px-3 py-1"
            >
              {row.connected ? "Disconnect Llavero" : "Connect Llavero"}
            </button>
          </form>
        </section>
      ))}
    </main>
  );
}
