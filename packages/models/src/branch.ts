export interface Branch {
  id: string;
  threadId: string;
  parentBranchId: string | null;
  forkPointMessageId: string | null;
  name: string;
  createdAt: Date;
}

export interface BranchTree {
  branch: Branch;
  children: BranchTree[];
  messageCount: number;
}
