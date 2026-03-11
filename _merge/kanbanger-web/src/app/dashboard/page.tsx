"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { CheckSquare, Plus } from "lucide-react";
import { CreateWorkspaceModal } from "@/components/workspace/create-workspace-modal";

export default function DashboardPage() {
  const router = useRouter();
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const { data: workspaces, isLoading } = api.workspace.list.useQuery();
  const utils = api.useUtils();

  const workspace = workspaces?.[0]?.workspace;

  useEffect(() => {
    if (!isLoading && workspace) {
      router.replace(`/dashboard/${workspace.slug}/tasks/ideas`);
    }
  }, [isLoading, workspace, router]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <>
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
          <div className="h-16 w-16 rounded-2xl bg-indigo-600 flex items-center justify-center mb-6">
            <CheckSquare className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Welcome to Tasks</h1>
          <p className="text-muted-foreground mb-6 max-w-md">
            Get started by creating your workspace. This is where you&apos;ll organize
            your projects and tasks.
          </p>
          <Button size="lg" onClick={() => setShowCreateWorkspace(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Your Workspace
          </Button>
        </div>
        {showCreateWorkspace && (
          <CreateWorkspaceModal
            onClose={() => setShowCreateWorkspace(false)}
            onSuccess={() => utils.workspace.list.invalidate()}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}
