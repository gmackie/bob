/**
 * Re-export of the shared provider-health model.
 *
 * The implementation moved to @bob/ws so the mobile node list and the tablet
 * cockpit render the same lights from the same rules. This file stays as the
 * import path the web app already uses; a copy here is exactly the drift the
 * move exists to prevent.
 */
export * from "@bob/ws";
