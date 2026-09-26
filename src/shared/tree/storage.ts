import {
  DEBUG_LOG_KEY_PREFIX,
  PENDING_TREE_REMOVAL_KEY_PREFIX,
  TREE_KEY_PREFIX,
  extractNumericSuffix,
} from "../storage-keys";
import { normalizeTree } from "./normalize";
import type { TreeState } from "./types";

/**
 * A saved tree together with when it was last written—used by `matchWindows`
 * to prefer a more recently saved candidate when two score close to each
 * other (see its own comments). Wall-clock time, not the window id it was
 * saved under: window/tab ids only increase within a single running browser
 * process and reset to small numbers on every real restart, so a tree saved
 * under a large id in a long-lived earlier session can otherwise outrank one
 * saved moments ago under a small, post-restart id.
 */
export interface StoredTree {
  tree: TreeState;
  savedAt: number;
}

/**
 * A tree saved before `savedAt` existed comes back as a bare `TreeState`
 * (no `tree`/`savedAt` wrapper) rather than a `StoredTree`. Treated as the
 * oldest possible save (`savedAt: 0`) rather than "just now"—it'll pick up a
 * real timestamp the next time anything actually re-saves it (which
 * ordinary tab activity does often), and in the meantime a real, freshly
 * timestamped candidate should always be preferred over it on recency.
 *
 * Exported so `useWindowTree` can apply the same fallback to a raw
 * `chrome.storage.local.onChanged` payload, which arrives as this same
 * on-disk shape rather than going through `loadTree`/`loadAllTrees`.
 */
export function unwrapStoredTree(value: unknown): StoredTree {
  if (
    value !== null &&
    typeof value === "object" &&
    "tree" in value &&
    "savedAt" in value
  ) {
    const stored = value as StoredTree;
    return { tree: normalizeTree(stored.tree), savedAt: stored.savedAt };
  }
  return { tree: normalizeTree(value as TreeState), savedAt: 0 };
}

/**
 * The `chrome.storage.local` key a window's tree is saved under.
 */
export function getStorageKey(windowId: number): string {
  return `${TREE_KEY_PREFIX}${windowId}`;
}

function getPendingRemovalKey(windowId: number): string {
  return `${PENDING_TREE_REMOVAL_KEY_PREFIX}${windowId}`;
}

// TODO(debug): temporary instrumentation—chases an intermittent bug where a
// window's tree ends up saved with zero nodes despite every native tab
// removal that closes a whole window being skipped (see the
// `isWindowClosing` check in `background/index.ts`'s `handleTabRemoved`),
// which should leave the tree untouched rather than emptying it. Records the
// call stack so the next occurrence points straight at whichever caller did
// this. Shares `background/index.ts`'s `debugLog` key prefix/shape so it's
// picked up by the same console snippets already used to read those
// entries, and pruned along with them by `pruneOldDebugLogs`.

/**
 * Persist a window's tree, stamped with the current time (see `StoredTree`).
 */
export async function saveTree(
  windowId: number,
  tree: TreeState,
): Promise<void> {
  if (Object.keys(tree.nodes).length === 0) {
    const key = `${DEBUG_LOG_KEY_PREFIX}${Date.now()}-emptySave-${windowId}`;
    void chrome.storage.local.set({
      [key]: {
        event: "saveTree:emptyTree",
        windowId,
        stack: new Error("saveTree: empty tree").stack,
        at: Date.now(),
      },
    });
  }

  const stored: StoredTree = { tree, savedAt: Date.now() };
  await chrome.storage.local.set({ [getStorageKey(windowId)]: stored });
}

/**
 * Load a window's saved tree, or `undefined` if none exists.
 */
export async function loadTree(
  windowId: number,
): Promise<StoredTree | undefined> {
  const key = getStorageKey(windowId);
  const result = await chrome.storage.local.get(key);
  return Object.hasOwn(result, key) ? unwrapStoredTree(result[key]) : undefined;
}

/**
 * Remove the saved tree for a window, e.g. once it's confirmed closed.
 * Also clears any pending-removal mark for it (see `markPendingRemoval`),
 * so a window id never re-used stops leaving that mark behind as orphaned
 * clutter once its tree itself is actually gone.
 */
export async function removeTree(windowId: number): Promise<void> {
  await chrome.storage.local.remove([
    getStorageKey(windowId),
    getPendingRemovalKey(windowId),
  ]);
}

/**
 * Marks a saved tree as unmatched by an `initializeAllWindows` pass, without
 * deleting it yet—records *when* it first went unmatched (a no-op if it's
 * already marked, so repeated misses don't keep pushing that timestamp
 * forward). A window that hasn't finished being recreated by session restore
 * in time for that pass's own snapshot (e.g. because another window—like a
 * lightweight installed-PWA window—was recreated first, possibly repeatedly
 * across several browser restarts before the real window ever reopens) would
 * otherwise have its real saved tree deleted as stale before it ever got a
 * chance to be matched. Only actually deleted once its mark is older than
 * `PENDING_REMOVAL_GRACE_MS` (see `loadPendingRemovals`)—the corresponding
 * window is presumed genuinely gone for good by then, not just slow to
 * reopen.
 */
export async function markPendingRemoval(windowId: number): Promise<void> {
  const key = getPendingRemovalKey(windowId);
  const existing = await chrome.storage.local.get(key);
  if (existing[key] !== undefined) {
    return;
  }
  await chrome.storage.local.set({ [key]: Date.now() });
}

/**
 * Clears a saved tree's pending-removal mark, e.g. once it matches again on
 * a later `initializeAllWindows` pass.
 */
export async function clearPendingRemoval(windowId: number): Promise<void> {
  await chrome.storage.local.remove(getPendingRemovalKey(windowId));
}

/**
 * Every window id currently marked pending removal, with the timestamp it
 * was first marked at (see `markPendingRemoval`).
 */
export async function loadPendingRemovals(): Promise<Map<number, number>> {
  const all = await chrome.storage.local.get(null);
  const markedAtByWindowId = new Map<number, number>();

  for (const [key, value] of Object.entries(all)) {
    const windowId = extractNumericSuffix(key, PENDING_TREE_REMOVAL_KEY_PREFIX);
    if (windowId !== undefined) {
      markedAtByWindowId.set(windowId, value as number);
    }
  }

  return markedAtByWindowId;
}

/**
 * Load every saved tree, keyed by the window id it was saved under.
 *
 * Window ids don't survive a browser restart, so on startup this is used to
 * find saved trees whose window no longer exists, in order to match them up
 * with the windows actually open (see `matchWindows`).
 */
export async function loadAllTrees(): Promise<Record<number, StoredTree>> {
  const all = await chrome.storage.local.get(null);
  const trees: Record<number, StoredTree> = {};

  for (const [key, value] of Object.entries(all)) {
    const windowId = extractNumericSuffix(key, TREE_KEY_PREFIX);
    if (windowId === undefined) {
      continue;
    }
    trees[windowId] = unwrapStoredTree(value);
  }

  return trees;
}
