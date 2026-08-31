import { normalizeTree } from "./normalize";
import type { TreeState } from "./types";

const KEY_PREFIX = "tabor:tree:";
// Deliberately not a `KEY_PREFIX`-prefixed name (e.g. "tabor:tree:pending...")
// —`loadAllTrees` below matches any key starting with `KEY_PREFIX`, so a mark
// key nested under it would get picked up there too and fail to parse as a
// window id.
const PENDING_REMOVAL_KEY_PREFIX = "tabor:pendingTreeRemoval:";

/**
 * The `chrome.storage.local` key a window's tree is saved under.
 */
export function getStorageKey(windowId: number): string {
  return `${KEY_PREFIX}${windowId}`;
}

function getPendingRemovalKey(windowId: number): string {
  return `${PENDING_REMOVAL_KEY_PREFIX}${windowId}`;
}

/**
 * Persist a window's tree.
 */
export async function saveTree(
  windowId: number,
  tree: TreeState,
): Promise<void> {
  await chrome.storage.local.set({ [getStorageKey(windowId)]: tree });
}

/**
 * Load a window's saved tree, or `undefined` if none exists.
 */
export async function loadTree(
  windowId: number,
): Promise<TreeState | undefined> {
  const key = getStorageKey(windowId);
  const result = await chrome.storage.local.get(key);
  const tree = result[key] as TreeState | undefined;
  return tree === undefined ? undefined : normalizeTree(tree);
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
    if (key.startsWith(PENDING_REMOVAL_KEY_PREFIX)) {
      markedAtByWindowId.set(
        Number(key.slice(PENDING_REMOVAL_KEY_PREFIX.length)),
        value as number,
      );
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
export async function loadAllTrees(): Promise<Record<number, TreeState>> {
  const all = await chrome.storage.local.get(null);
  const trees: Record<number, TreeState> = {};

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(KEY_PREFIX)) {
      continue;
    }
    const windowId = Number(key.slice(KEY_PREFIX.length));
    trees[windowId] = normalizeTree(value as TreeState);
  }

  return trees;
}
