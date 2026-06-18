interface LegacyTaskRunLink {
  id: string;
  legacyWorkItemId: string;
  sessionId: string | null;
  identifier: string;
}

interface LegacyChatSessionLink {
  id: string;
  legacyWorkItemId: string;
  identifier: string;
}

export function buildSessionTaskLinkBackfill(input: {
  legacyToWorkItemId: Record<string, string>;
  taskRuns: LegacyTaskRunLink[];
  chatSessions: LegacyChatSessionLink[];
}) {
  return {
    taskRunUpdates: input.taskRuns
      .map((taskRun) => {
        const workItemId = input.legacyToWorkItemId[taskRun.legacyWorkItemId];
        if (!workItemId) {
          return null;
        }

        return {
          id: taskRun.id,
          workItemId,
          workItemIdentifierSnapshot: taskRun.identifier,
        };
      })
      .filter(
        (
          taskRun,
        ): taskRun is {
          id: string;
          workItemId: string;
          workItemIdentifierSnapshot: string;
        } => taskRun !== null,
      ),
    chatSessionUpdates: input.chatSessions
      .map((chatSession) => {
        const workItemId = input.legacyToWorkItemId[chatSession.legacyWorkItemId];
        if (!workItemId) {
          return null;
        }

        return {
          id: chatSession.id,
          workItemId,
          workItemIdentifierSnapshot: chatSession.identifier,
        };
      })
      .filter(
        (
          chatSession,
        ): chatSession is {
          id: string;
          workItemId: string;
          workItemIdentifierSnapshot: string;
        } => chatSession !== null,
      ),
  };
}
