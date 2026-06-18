export {
  createThreadWorkspace,
  type CreateWorkspaceInput,
  type CreateWorkspaceResult,
} from "./create-thread-workspace";

export {
  promoteNote,
  type PromoteNoteInput,
  type PromoteNoteResult,
} from "./promote-note";

export { exportBrief, type ExportBriefInput } from "./export-brief";

export { readNotes, type WorkspaceNote } from "./read-notes";

export { scanThreads, type ScannedThread } from "./scan-threads";

export {
  initVaultRepo,
  pushVault,
  pullVault,
  hasConflicts,
  getConflictedThreads,
  resolveConflict,
  commitMerge,
  abortMerge,
  type PullResult,
} from "./sync-vault";
