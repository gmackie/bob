"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { GearIcon, ExitIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useTRPC } from "~/trpc/react";
import {
  buildShellSettingsActions,
  buildWorkspaceSwitchHref,
  selectCurrentWorkspace,
  type ShellWorkspace,
} from "./shell-settings-model";

type WorkspaceMembership = {
  workspace?: ShellWorkspace | null;
};

export function ShellSettingsMenu() {
  const trpc = useTRPC();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      staleTime: 60_000,
      refetchInterval: 30_000,
    }),
  );

  const workspaces = useMemo(() => {
    const memberships = (workspaceMemberships ?? []) as unknown as WorkspaceMembership[];
    return memberships.flatMap((membership) =>
      membership.workspace ? [membership.workspace] : [],
    );
  }, [workspaceMemberships]);
  const currentPath = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
  const currentWorkspace = selectCurrentWorkspace(
    workspaces,
    searchParams?.get("workspace") ?? null,
  );
  const actions = buildShellSettingsActions(currentWorkspace?.id);

  async function handleLogout() {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <div className="fixed right-4 top-4 z-30">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Open settings"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-2 text-sm font-medium text-foreground shadow-lg shadow-black/10 backdrop-blur transition-colors hover:bg-accent"
      >
        <GearIcon className="size-4" />
        <span className="hidden max-w-[11rem] truncate sm:inline">
          {currentWorkspace?.name ?? "Settings"}
        </span>
      </button>

      {open ? (
        <div className="mt-2 w-80 overflow-hidden rounded-xl border border-border bg-background shadow-2xl shadow-black/20">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Workspace
            </p>
            <p className="mt-1 truncate text-sm font-medium text-foreground">
              {currentWorkspace?.name ?? "No workspace selected"}
            </p>
          </div>

          <div className="max-h-52 overflow-y-auto border-b border-border p-2">
            {workspaces.length === 0 ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">
                No workspaces available.
              </p>
            ) : (
              workspaces.map((workspace) => (
                <Link
                  key={workspace.id}
                  href={buildWorkspaceSwitchHref(currentPath, workspace.id)}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent",
                    workspace.id === currentWorkspace?.id
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="truncate">{workspace.name}</span>
                  {workspace.id === currentWorkspace?.id ? (
                    <span className="ml-3 text-[10px] uppercase tracking-wide">Current</span>
                  ) : null}
                </Link>
              ))
            )}
          </div>

          <div className="p-2">
            {actions
              .filter((action) => action.key !== "workspace")
              .map((action) =>
                action.kind === "logout" ? (
                  <button
                    key={action.key}
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-rose-500 transition-colors hover:bg-rose-500/10"
                  >
                    <ExitIcon className="size-4" />
                    {action.label}
                  </button>
                ) : (
                  <Link
                    key={action.key}
                    href={action.href ?? "/settings"}
                    onClick={() => setOpen(false)}
                    className="block rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {action.label}
                  </Link>
                ),
              )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
