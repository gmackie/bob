// Bundler-style resolution: drop the explicit `.js` extension so Next's
// Turbopack can resolve sibling modules to their `.ts` sources without
// needing to walk the NodeNext `.js` alias. The package is consumed
// source-first (see exports map in package.json), so extensionless
// imports are the low-friction path.
export type { VaultConfig, VaultFile } from "./types";
export { listFiles, readFile } from "./reader";
export { writeFile, writeFileOnce, deleteFile } from "./writer";
export {
  isLocked,
  hasConflicts,
  commitAndPush,
  pull,
  acquireLock,
  releaseLock,
} from "./git";
export type { PullResult, CommitAndPushOptions } from "./git";
export type {
  CapabilityManifest,
  ObjectFormat,
  PublicationIntent,
  PublicationReceipt,
  PublicationRecord,
  PublicationState,
  PublishRequest,
  RemoteHeadResult,
  RevisionRef,
  RevisionSelector,
  VersionedStorageErrorCode,
  VersionedStoragePort,
} from "./versioned-storage";
export {
  VersionedStorageError,
  isDurablyPublished,
  REPLAYABLE_STATES,
} from "./versioned-storage";
export { LocalGitStorage, publicationInputDigest } from "./local-git-storage";
export type { LocalGitStorageOptions } from "./local-git-storage";
export { PublicationJournal } from "./publication-journal";
export { startPullTimer } from "./pull-timer";
export { VaultService } from "./vault-service";
export type { PromoteResult } from "./vault-service";
export type { PublishOptions, PublishedDraft } from "./publish";
export { publishDraft, slugify } from "./publish";
export type { Draft, DraftMetadata, NewDraftMetadata } from "./drafts";
export { writeDraft, listDrafts } from "./drafts";

export { ForgePublicationStorage } from "./forge-publication-storage";
export type { ForgeVaultBinding, ForgeVaultClient, ForgeVaultPublication } from "./forge-publication-storage";

export { VaultRouteHost } from "./vault-route-host";
export type { VaultRouteBinding } from "./vault-route-host";
