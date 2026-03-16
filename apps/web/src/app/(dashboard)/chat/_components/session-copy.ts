export function getManagedSessionLabel(issueManaged?: boolean): string | null {
  if (!issueManaged) {
    return null;
  }

  return "Task-linked session";
}
