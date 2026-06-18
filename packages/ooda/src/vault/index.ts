// Bundler-style resolution: drop the explicit `.js` extension so Next's
// Turbopack can resolve sibling modules to their `.ts` sources without
// needing to walk the NodeNext `.js` alias. The package is consumed
// source-first (see exports map in package.json), so extensionless
// imports are the low-friction path.
export type { VaultConfig, VaultFile } from "./types";
export { listFiles, readFile } from "./reader";
export { writeFile, deleteFile } from "./writer";
export {
  isLocked,
  hasConflicts,
  commitAndPush,
  pull,
  acquireLock,
  releaseLock,
} from "./git";
export type { PullResult } from "./git";
export { startPullTimer } from "./pull-timer";
export { VaultService } from "./vault-service";
export type { PublishOptions } from "./publish";
export { publishDraft, slugify } from "./publish";
export type { Draft, DraftMetadata, NewDraftMetadata } from "./drafts";
export { writeDraft, listDrafts } from "./drafts";
