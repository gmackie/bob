/** The user ids on a comma-separated allow-list (SDLC_VIEWER_USER_IDS), deduplicated. */
export const viewerList = (csv: string | undefined) =>
  [...new Set((csv ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
/** Whether userId is on a comma-separated allow-list (SDLC_VIEWER_USER_IDS). Empty: nobody. */
export const isViewer = (userId: string, csv: string | undefined) => viewerList(csv).includes(userId);
