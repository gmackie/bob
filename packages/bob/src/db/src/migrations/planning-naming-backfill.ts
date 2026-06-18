type BackfillableLinkType =
  | "planning_task"
  | "kanbanger_task"
  | "github_pr"
  | "github_issue"
  | "control_panel"
  | "external";

type BackfillableWebhookProvider =
  | "planning"
  | "kanbanger"
  | "github"
  | "gitlab"
  | "gitea";

interface WorktreeLinkRecord {
  id: string;
  linkType: BackfillableLinkType;
}

interface WebhookDeliveryRecord {
  id: string;
  provider: BackfillableWebhookProvider;
  eventType: string;
}

function toPlanningLinkType(linkType: BackfillableLinkType): BackfillableLinkType {
  return linkType === "kanbanger_task" ? "planning_task" : linkType;
}

function toPlanningWebhookProvider(
  provider: BackfillableWebhookProvider,
): BackfillableWebhookProvider {
  return provider === "kanbanger" ? "planning" : provider;
}

function toPlanningEventType(eventType: string): string {
  switch (eventType) {
    case "kanbanger_comment":
      return "planning_comment";
    case "kanbanger_comment_late":
      return "planning_comment_late";
    default:
      return eventType;
  }
}

export function buildPlanningNamingBackfill(input: {
  worktreeLinks: WorktreeLinkRecord[];
  webhookDeliveries: WebhookDeliveryRecord[];
}) {
  return {
    worktreeLinks: input.worktreeLinks.map((link) => ({
      ...link,
      linkType: toPlanningLinkType(link.linkType),
    })),
    webhookDeliveries: input.webhookDeliveries.map((delivery) => ({
      ...delivery,
      provider: toPlanningWebhookProvider(delivery.provider),
      eventType: toPlanningEventType(delivery.eventType),
    })),
  };
}
