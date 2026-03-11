export async function createContext() {
  return {
    userId: "test-user-id",
    db: null,
  };
}

export function buildIssuePayload(issue: { id: string }) {
  return { id: issue.id };
}

export async function dispatchWebhook() {
  return undefined;
}
