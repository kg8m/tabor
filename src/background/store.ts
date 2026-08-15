import type { RestoreSession } from "../shared/tree/restore";
import type { TreeState } from "../shared/tree/types";

const EMPTY_TREE: TreeState = { nodes: {}, rootIds: [] };

const trees = new Map<number, TreeState>();
const activeTabIds = new Map<number, number>();
const restoreSessions = new Map<number, RestoreSession>();

export function getTree(windowId: number): TreeState {
  return trees.get(windowId) ?? EMPTY_TREE;
}

export function setTree(windowId: number, tree: TreeState): void {
  trees.set(windowId, tree);
}

export function getAllTrees(): Record<number, TreeState> {
  return Object.fromEntries(trees);
}

export function getActiveTabId(windowId: number): number | undefined {
  return activeTabIds.get(windowId);
}

export function setActiveTabId(windowId: number, tabId: number): void {
  activeTabIds.set(windowId, tabId);
}

export function getRestoreSession(
  windowId: number,
): RestoreSession | undefined {
  return restoreSessions.get(windowId);
}

export function setRestoreSession(
  windowId: number,
  session: RestoreSession,
): void {
  restoreSessions.set(windowId, session);
}

/**
 * Drops a window's restore session once it's no longer needed (see
 * `initializeWindow`/`initializeAllWindows`), so a tab opened much later
 * can't be mismatched against a leftover saved node that was never
 * consumed—one whose URL just happens to match, from a saved tree that had
 * more tabs with that URL than were actually open at startup.
 */
export function removeRestoreSession(windowId: number): void {
  restoreSessions.delete(windowId);
}

export function deleteWindow(windowId: number): void {
  trees.delete(windowId);
  activeTabIds.delete(windowId);
  restoreSessions.delete(windowId);
}
