"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useMutation } from "@tanstack/react-query";

import { toast } from "@bob/ui/toast";

import type { WorkflowPlanningLaunchContext } from "~/components/workflow/workflow-launch-dialog";
import { useTRPC } from "~/trpc/react";

interface ChatPanelState {
  isOpen: boolean;
  sessionId: string | null;
  workItemId: string | null;
  contextLabel: string | null;
}

interface ChatPanelContextValue extends ChatPanelState {
  openPanel: (opts?: {
    sessionId?: string;
    workItemId?: string;
    label?: string;
  }) => void;
  closePanel: () => void;
  openPlanningSession: (opts: {
    workItemId: string;
    title: string;
    workspaceId?: string;
    projectId?: string;
    projectName?: string;
    workingDirectory?: string;
    launchContext?: WorkflowPlanningLaunchContext;
  }) => void;
  isPlanningSessionLoading: boolean;
}

const ChatPanelContext = createContext<ChatPanelContextValue>({
  isOpen: false,
  sessionId: null,
  workItemId: null,
  contextLabel: null,
  openPanel: () => {},
  closePanel: () => {},
  openPlanningSession: () => {},
  isPlanningSessionLoading: false,
});

export function useChatPanel() {
  return useContext(ChatPanelContext);
}

export function ChatPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const trpc = useTRPC();

  const [state, setState] = useState<ChatPanelState>({
    isOpen: false,
    sessionId: null,
    workItemId: null,
    contextLabel: null,
  });

  const openPanel = useCallback(
    (opts?: {
      sessionId?: string;
      workItemId?: string;
      label?: string;
    }) => {
      setState({
        isOpen: true,
        sessionId: opts?.sessionId ?? null,
        workItemId: opts?.workItemId ?? null,
        contextLabel: opts?.label ?? null,
      });
    },
    [],
  );

  const closePanel = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const createSession = useMutation(
    trpc.planSession.create.mutationOptions(),
  );
  const startSession = useMutation(
    trpc.planSession.start.mutationOptions(),
  );

  const openPlanningSession = useCallback(
    async (opts: {
      workItemId: string;
      title: string;
      workspaceId?: string;
      projectId?: string;
      projectName?: string;
      workingDirectory?: string;
      launchContext?: WorkflowPlanningLaunchContext;
    }) => {
      try {
        const session = await createSession.mutateAsync({
          workspaceId: opts.workspaceId,
          projectId: opts.projectId,
          workingDirectory: opts.workingDirectory,
          workItemId: opts.workItemId,
          title: `Planning: ${opts.title}`.slice(0, 256),
        });

        if (opts.workspaceId && opts.projectId) {
          await startSession.mutateAsync({
            sessionId: session.id,
            workspaceId: opts.workspaceId,
            projectId: opts.projectId,
            projectName: opts.projectName ?? "Project",
            workingDirectory: opts.workingDirectory ?? "/",
            launchContext: opts.launchContext,
          });
        }

        setState({
          isOpen: true,
          sessionId: session.id,
          workItemId: opts.workItemId,
          contextLabel: `Planning: ${opts.title.slice(0, 40)}`,
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to start planning session";
        toast(message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      }
    },
    [createSession, startSession],
  );

  const value = useMemo(
    () => ({
      ...state,
      openPanel,
      closePanel,
      openPlanningSession,
      isPlanningSessionLoading:
        createSession.isPending || startSession.isPending,
    }),
    [
      state,
      openPanel,
      closePanel,
      openPlanningSession,
      createSession.isPending,
      startSession.isPending,
    ],
  );

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
}
