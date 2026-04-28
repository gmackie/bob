export type ThreadStatus = "active" | "paused" | "archived" | "completed";

export interface Thread {
  id: string;
  title: string;
  status: ThreadStatus;
  activeBranchId: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}
