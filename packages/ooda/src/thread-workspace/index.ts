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
  replayVaultPublications,
  listUnpublishedVaultPublications,
  pullVault,
  hasConflicts,
  getConflictedThreads,
  resolveConflict,
  commitMerge,
  abortMerge,
  type PullResult,
  type VaultPushResult,
} from "./sync-vault";

export {
  createOutlineBundle,
  type CreateOutlineBundleInput,
  type CreateOutlineBundleResult,
  type OutlineBundleFile,
} from "./create-outline-bundle";
