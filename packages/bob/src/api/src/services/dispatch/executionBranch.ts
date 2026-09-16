import { slugify } from "@bob/work-items";

/** Each execution owns a new ref; existing item branches may hold user work. */
export function createExecutionBranch(title: string): string {
  const suffix = slugify(title);
  return `bob/run-${crypto.randomUUID()}${suffix ? `-${suffix}` : ""}`;
}
