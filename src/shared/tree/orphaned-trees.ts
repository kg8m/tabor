/**
 * The window ids among `savedWindowIds` that no currently open window has—
 * saved trees left behind by windows that have since closed. Most of these
 * are still waiting to be matched to a window reopened after a browser
 * restart (see `initializeAllWindows`), and one with parent/child structure
 * can wait up to `PENDING_REMOVAL_GRACE_MS` before being removed
 * automatically; this is what lets the user remove one sooner by hand.
 */
export function selectOrphanedWindowIds(
  savedWindowIds: Iterable<number>,
  openWindowIds: Iterable<number>,
): number[] {
  const open = new Set(openWindowIds);
  return [...savedWindowIds].filter((windowId) => !open.has(windowId));
}
