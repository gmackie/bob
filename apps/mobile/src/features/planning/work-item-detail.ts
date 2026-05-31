import { getTaskWorkspaceHref } from "./navigation";

interface WorkItemDetailPresentationInput {
  id: string;
  kind: "issue" | "epic" | "task";
}

export function getWorkItemDetailPresentation(
  input: WorkItemDetailPresentationInput,
) {
  if (input.kind === "task") {
    return {
      primaryActionLabel: "Open execution workspace",
      executionHref: getTaskWorkspaceHref(input.id),
      semanticSummary: "Tasks are the executable unit for BizPulse.",
      semanticHint:
        "Open the execution workspace to chat, review status, and inspect artifacts.",
    };
  }

  if (input.kind === "epic") {
    return {
      primaryActionLabel: "Promote to task",
      executionHref: getTaskWorkspaceHref(input.id),
      semanticSummary: "Epics organize work before execution begins.",
      semanticHint:
        "Promote this epic to a task when this specific item is ready for Bob.",
    };
  }

  return {
    primaryActionLabel: "Promote to task",
    executionHref: getTaskWorkspaceHref(input.id),
    semanticSummary: "Issues capture work to be shaped before execution.",
    semanticHint: "Promote this issue to a task when it is ready for Bob.",
  };
}
