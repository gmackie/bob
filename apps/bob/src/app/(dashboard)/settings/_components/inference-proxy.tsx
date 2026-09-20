"use client";

/**
 * Settings → Inference proxy.
 *
 * The proxy is configured on each runner host (CLIPROXY_BASE_URL,
 * CLIPROXY_API_KEY, CLIPROXY_MANAGEMENT_KEY, BOB_PROVIDER_AUTH_MODE), not in
 * Bob's database: the management key must never leave the host. So this
 * section shows, per workspace, what the host reports about its proxy — the
 * same panel as the node page, read-only here — and names the variables that
 * change it. Actions live on the node page next to the agent credentials.
 */

import { useQuery } from "@tanstack/react-query";

import type { HostSnapshotWire } from "@bob/ws";

import { ProxyPanel } from "~/components/nodes/proxy-panel";
import { useBobRpcClient } from "~/rpc/react";

interface WorkspaceRow {
  id: string;
  name?: string | null;
  slug?: string | null;
  machineId?: string | null;
}

interface WorkspaceMembership {
  workspace?: WorkspaceRow | null;
}

const VARIABLES: Array<[name: string, meaning: string]> = [
  ["CLIPROXY_BASE_URL", "Proxy origin. Required for proxy routing."],
  ["CLIPROXY_API_KEY", "Inference key the CLIs present to the proxy. Required."],
  ["CLIPROXY_MANAGEMENT_KEY", "Lists and controls accounts. Optional; without it only reachability is reported."],
  ["BOB_PROVIDER_AUTH_MODE", "proxy (default when a route exists), subscription, or api_key; per-provider overrides with _CLAUDE, _CODEX."],
];

function WorkspaceProxy({ workspace }: { workspace: WorkspaceRow }) {
  const { data: snapshot } = useQuery<HostSnapshotWire | null>({
    queryKey: ["hostSnapshot", workspace.id],
    queryFn: () => null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const label = workspace.name || workspace.slug || workspace.machineId || workspace.id;
  return (
    <div className="rounded-md border border-border p-3" data-testid={`settings-proxy-${workspace.id}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{label}</span>
        <a
          href={`/nodes/${encodeURIComponent(workspace.machineId || workspace.slug || workspace.id)}`}
          className="text-xs text-primary hover:underline"
        >
          Manage on the node page →
        </a>
      </div>
      {snapshot?.proxy ? (
        <ProxyPanel snapshot={snapshot} />
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {snapshot
            ? "This host is not routed through an inference proxy."
            : "No heartbeat from this host yet — the proxy state arrives with it."}
        </p>
      )}
    </div>
  );
}

export function InferenceProxySection() {
  const rpc = useBobRpcClient();
  const { data: workspaceMemberships, isLoading } = useQuery({
    queryKey: ["rpc", "projects.workspace.list"],
    queryFn: () => rpc.projects.workspace.list() as Promise<readonly WorkspaceMembership[]>,
  });

  const rows = (workspaceMemberships ?? [])
    .map((membership) => membership.workspace)
    .filter((workspace): workspace is WorkspaceRow => Boolean(workspace));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Production inference goes through CLIProxyAPI. Each runner host is pointed at it by its own
        environment file; the proxy's management key stays on the host and never enters Bob. What the
        host reports is shown here, and can be acted on from its node page.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading workspaces…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No workspaces yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((workspace) => (
            <WorkspaceProxy key={workspace.id} workspace={workspace} />
          ))}
        </div>
      )}

      <details className="rounded-md border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Host variables</summary>
        <table className="mt-2 w-full text-xs">
          <tbody className="divide-y divide-border">
            {VARIABLES.map(([name, meaning]) => (
              <tr key={name}>
                <td className="py-1 pr-3 align-top font-mono">{name}</td>
                <td className="py-1 text-muted-foreground">{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Set them in the runner's environment file and restart the runner; the next heartbeat carries the
          result. Never paste a key into Bob.
        </p>
      </details>
    </div>
  );
}
