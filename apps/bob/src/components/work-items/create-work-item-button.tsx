"use client";

import React, { useState } from "react";
import { PlusIcon } from "@radix-ui/react-icons";

import { Button } from "@gmacko/core/ui/button";

import { CreateWorkItemDialog } from "./create-work-item-dialog";

interface CreateWorkItemButtonProps {
  projectId?: string;
  projects?: Array<{ id: string; name: string; key: string }>;
}

export function CreateWorkItemButton({
  projectId,
  projects,
}: CreateWorkItemButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon />
        New work item
      </Button>
      <CreateWorkItemDialog
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        projects={projects}
      />
    </>
  );
}
