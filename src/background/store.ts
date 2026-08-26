import type { RestoreSession } from "../shared/tree/restore";
import type { TreeState } from "../shared/tree/types";

const EMPTY_TREE: TreeState = { nodes: {}, rootIds: [] };

const trees = new Map<number, TreeState>();
const activeTabIds = new Map<number, number>();
const previousActiveTabIds = new Map<number, number>();
const restoreSessions = new Map<number, RestoreSession>();

/**
 * The in-memory tree for a window, or an empty tree if none has been set yet.
 */
export function getTree(windowId: number): TreeState {
  return trees.get(windowId) ?? EMPTY_TREE;
}

/**
 * Replace the in-memory tree for a window.
 */
export function setTree(windowId: number, tree: TreeState): void {
  trees.set(windowId, tree);
}

/**
 * Every window's in-memory tree, keyed by window id.
 */
export function getAllTrees(): Record<number, TreeState> {
  return Object.fromEntries(trees);
}

/**
 * The tab currently marked active in a window, or `undefined` if not yet
 * known.
 */
export function getActiveTabId(windowId: number): number | undefined {
  return activeTabIds.get(windowId);
}

/**
 * The tab that was active immediately before the current one—closing the
 * active tab natively (not through Tabor's own UI) fires `tabs.onActivated`
 * for Chrome's own replacement pick *before* `tabs.onRemoved` for the closed
 * tab, so by the time `onRemoved` runs, `getActiveTabId` already reflects
 * the replacement rather than the tab that just closed. `noteTabRemoved`
 * (`pending-close.ts`) falls back to this to recover which tab was actually
 * active when the close happened.
 */
export function getPreviousActiveTabId(windowId: number): number | undefined {
  return previousActiveTabIds.get(windowId);
}

/**
 * Record which tab is now active in a window, remembering the previous one
 * for `getPreviousActiveTabId`.
 */
export function setActiveTabId(windowId: number, tabId: number): void {
  const current = activeTabIds.get(windowId);
  if (current !== undefined) {
    previousActiveTabIds.set(windowId, current);
  }
  activeTabIds.set(windowId, tabId);
}

/**
 * The in-progress `RestoreSession` for a window, if one is active.
 */
export function getRestoreSession(
  windowId: number,
): RestoreSession | undefined {
  return restoreSessions.get(windowId);
}

/**
 * Record the in-progress `RestoreSession` for a window.
 */
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

/**
 * Drop all in-memory state for a window, e.g. once it's confirmed closed.
 */
export function deleteWindow(windowId: number): void {
  trees.delete(windowId);
  activeTabIds.delete(windowId);
  previousActiveTabIds.delete(windowId);
  restoreSessions.delete(windowId);
}
