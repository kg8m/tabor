/**
 * The tree ids among `savedTreeIds` that no currently open window holds
 * (`heldTreeIds`)—saved trees left behind by windows that have since
 * closed. Most of these are still waiting to be matched to a window reopened
 * later (see `initializeAllWindows`), and one with parent/child structure
 * can wait up to `PENDING_REMOVAL_GRACE_MS` before being removed
 * automatically; this is what lets the user remove one sooner by hand.
 */
export function selectOrphanedTreeIds(
  savedTreeIds: Iterable<string>,
  heldTreeIds: Iterable<string>,
): string[] {
  const held = new Set(heldTreeIds);
  return [...savedTreeIds].filter((treeId) => !held.has(treeId));
}
