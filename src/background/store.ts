import type { RestoreSession } from "../shared/tree/restore";
import type { TreeState } from "../shared/tree/types";

const EMPTY_TREE: TreeState = { nodes: {}, rootIds: [] };

const trees = new Map<number, TreeState>();
const treeIds = new Map<number, string>();
const activeTabIds = new Map<number, number>();
const previousActiveTabIds = new Map<number, number>();
const restoreSessions = new Map<number, RestoreSession>();
const deletedWindowIds = new Set<number>();
const incognitoWindowIds = new Set<number>();

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
 * The id of the tree a window holds (see `WINDOW_TREE_KEY_PREFIX`), or
 * `undefined` if it hasn't been assigned one yet.
 */
export function getTreeId(windowId: number): string | undefined {
  return treeIds.get(windowId);
}

/**
 * Record which tree a window holds.
 */
export function setTreeId(windowId: number, treeId: string): void {
  treeIds.set(windowId, treeId);
}

/**
 * Every window's tree id, keyed by window id.
 */
export function getAllTreeIds(): Map<number, string> {
  return new Map(treeIds);
}

/**
 * Whether a window is an incognito one. Kept in memory rather than queried
 * from `chrome.windows` when needed, since by `windows.onRemoved` the window
 * can no longer be looked up.
 */
export function isIncognitoWindow(windowId: number): boolean {
  return incognitoWindowIds.has(windowId);
}

/**
 * Record whether a window is an incognito one (see `isIncognitoWindow`).
 */
export function setIncognitoWindow(
  windowId: number,
  isIncognito: boolean,
): void {
  if (isIncognito) {
    incognitoWindowIds.add(windowId);
  } else {
    incognitoWindowIds.delete(windowId);
  }
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
 * Also marks the window id as deleted (see `isDeletedWindow`): Chrome doesn't
 * guarantee `windows.onRemoved` fires only after every one of that window's
 * own `tabs.onRemoved`/`onActivated`/etc. events has already been delivered—a
 * straggler among them arriving after this runs would otherwise see `getTree`
 * fall back to an empty tree (this window id no longer being in `trees`) and,
 * for a handler that persists whatever it computes regardless, overwrite this
 * window's still-valid saved tree with that empty one.
 */
export function deleteWindow(windowId: number): void {
  trees.delete(windowId);
  treeIds.delete(windowId);
  activeTabIds.delete(windowId);
  previousActiveTabIds.delete(windowId);
  restoreSessions.delete(windowId);
  incognitoWindowIds.delete(windowId);
  deletedWindowIds.add(windowId);
}

/**
 * Whether `deleteWindow` has been called for this window id and it hasn't
 * been reinitialized since (see `clearDeletedWindow`). Event handlers check
 * this before acting on a window id, to guard against exactly the stale-event
 * scenario `deleteWindow` documents above.
 */
export function isDeletedWindow(windowId: number): boolean {
  return deletedWindowIds.has(windowId);
}

/**
 * Clears a window id's deleted-marker once it's genuinely live again (e.g.
 * `initializeWindow`/`initializeAllWindows` starting to treat it as such).
 * Window ids aren't normally reused within a browser session, so this is
 * mostly a safety net rather than something expected to matter in practice.
 */
export function clearDeletedWindow(windowId: number): void {
  deletedWindowIds.delete(windowId);
}
