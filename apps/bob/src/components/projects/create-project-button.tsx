"use client";

import { useState } from "react";
import { PlusIcon } from "@radix-ui/react-icons";

import { Button } from "@gmacko/core/ui/button";

import { CreateProjectDialog } from "./create-project-dialog";

interface CreateProjectButtonProps {
  workspaceId: string;
}

export function CreateProjectButton({ workspaceId }: CreateProjectButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon />
        New project
      </Button>
      <CreateProjectDialog
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
      />
    </>
  );
}
