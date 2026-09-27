import {
  DEBUG_LOG_KEY_PREFIX,
  LEGACY_TREE_KEY_PREFIX,
  PENDING_TREE_REMOVAL_KEY_PREFIX,
  TREE_ID_KEY_PREFIX,
  WINDOW_TREE_KEY_PREFIX,
  loadValuesBySuffix,
  parseNonNegativeInteger,
  parseTreeId,
} from "../storage-keys";
import { normalizeTree } from "./normalize";
import type { TreeState } from "./types";

/**
 * A saved tree together with when it was last written—used by `matchWindows`
 * to prefer a more recently saved candidate when two score close to each
 * other (see its own comments).
 *
 * `incognito` marks an incognito window's tree, so it can be told apart from
 * the saved data alone—even once its window is gone, e.g. after a crash kept
 * it from being removed when that window closed. Left out altogether for a
 * normal window's tree, which a tree saved before this field existed also
 * reads as.
 */
export interface StoredTree {
  tree: TreeState;
  savedAt: number;
  incognito?: true;
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
    return {
      tree: normalizeTree(stored.tree),
      savedAt: stored.savedAt,
      ...(stored.incognito === true && { incognito: true }),
    };
  }
  return { tree: normalizeTree(value as TreeState), savedAt: 0 };
}

/**
 * A new, unique id for a window's tree (see `WINDOW_TREE_KEY_PREFIX`).
 */
export function createTreeId(): string {
  return crypto.randomUUID();
}

/**
 * The `chrome.storage.local` key a tree is saved under.
 */
export function getStorageKey(treeId: string): string {
  return `${WINDOW_TREE_KEY_PREFIX}${treeId}`;
}

function getPendingRemovalKey(treeId: string): string {
  return `${PENDING_TREE_REMOVAL_KEY_PREFIX}${treeId}`;
}

function getLegacyStorageKey(windowId: number): string {
  return `${LEGACY_TREE_KEY_PREFIX}${windowId}`;
}

function getLegacyPendingRemovalKey(windowId: number): string {
  return `${PENDING_TREE_REMOVAL_KEY_PREFIX}${windowId}`;
}

/**
 * The `chrome.storage.session` key recording which tree an open window
 * holds (see `TREE_ID_KEY_PREFIX`).
 */
export function getTreeIdStorageKey(windowId: number): string {
  return `${TREE_ID_KEY_PREFIX}${windowId}`;
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
 * Persist a tree, stamped with the current time and marked as an incognito
 * window's if it is one (see `StoredTree`).
 */
export async function saveTree(
  treeId: string,
  tree: TreeState,
  { incognito = false }: { incognito?: boolean } = {},
): Promise<void> {
  if (Object.keys(tree.nodes).length === 0) {
    const key = `${DEBUG_LOG_KEY_PREFIX}${Date.now()}-emptySave-${treeId}`;
    void chrome.storage.local.set({
      [key]: {
        event: "saveTree:emptyTree",
        treeId,
        stack: new Error("saveTree: empty tree").stack,
        at: Date.now(),
      },
    });
  }

  const stored: StoredTree = {
    tree,
    savedAt: Date.now(),
    ...(incognito && { incognito: true }),
  };
  await chrome.storage.local.set({ [getStorageKey(treeId)]: stored });
}

/**
 * Load a saved tree, or `undefined` if none exists.
 */
export async function loadTree(
  treeId: string,
): Promise<StoredTree | undefined> {
  const key = getStorageKey(treeId);
  const result = await chrome.storage.local.get(key);
  return Object.hasOwn(result, key) ? unwrapStoredTree(result[key]) : undefined;
}

/**
 * Remove a saved tree, along with its pending-removal mark (see
 * `markPendingRemoval`) so that doesn't stay behind as orphaned clutter.
 */
export async function removeTree(treeId: string): Promise<void> {
  await chrome.storage.local.remove([
    getStorageKey(treeId),
    getPendingRemovalKey(treeId),
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
export async function markPendingRemoval(treeId: string): Promise<void> {
  const key = getPendingRemovalKey(treeId);
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
export async function clearPendingRemoval(treeId: string): Promise<void> {
  await chrome.storage.local.remove(getPendingRemovalKey(treeId));
}

/**
 * Every tree id currently marked pending removal, with the timestamp it was
 * first marked at (see `markPendingRemoval`).
 */
export async function loadPendingRemovals(): Promise<Map<string, number>> {
  const marks = await loadValuesBySuffix(
    PENDING_TREE_REMOVAL_KEY_PREFIX,
    parseTreeId,
  );
  return marks as Map<string, number>;
}

/**
 * Load every saved tree, keyed by tree id—whether an open window holds it
 * or not (see `loadTreeIdsByWindowId`).
 */
export async function loadAllTrees(): Promise<Map<string, StoredTree>> {
  const stored = await loadValuesBySuffix(WINDOW_TREE_KEY_PREFIX, parseTreeId);
  return new Map(
    stored
      .entries()
      .map(([treeId, value]) => [treeId, unwrapStoredTree(value)]),
  );
}

/**
 * Records that `windowId` now holds the tree saved under `treeId`.
 */
export async function saveTreeIdForWindow(
  windowId: number,
  treeId: string,
): Promise<void> {
  await chrome.storage.session.set({ [getTreeIdStorageKey(windowId)]: treeId });
}

/**
 * The id of the tree `windowId` holds, or `undefined` if it hasn't been
 * assigned one yet (e.g. the background hasn't initialized it yet).
 */
export async function loadTreeIdForWindow(
  windowId: number,
): Promise<string | undefined> {
  const key = getTreeIdStorageKey(windowId);
  const result = await chrome.storage.session.get(key);
  return result[key] as string | undefined;
}

/**
 * Forgets which tree `windowId` held, once it's closed—leaving that tree a
 * closed window's saved tree.
 */
export async function removeTreeIdForWindow(windowId: number): Promise<void> {
  await chrome.storage.session.remove(getTreeIdStorageKey(windowId));
}

/**
 * Every window currently recorded as holding a tree, with that tree's id.
 */
export async function loadTreeIdsByWindowId(): Promise<Map<number, string>> {
  const treeIds = await loadValuesBySuffix(
    TREE_ID_KEY_PREFIX,
    parseNonNegativeInteger,
    chrome.storage.session,
  );
  return treeIds as Map<number, string>;
}

/**
 * What `migrateLegacyTrees` should write and remove, given the legacy trees
 * (keyed by the window id they were saved under) and pending-removal marks
 * currently in storage. Pure, so it can be tested without `chrome.storage`;
 * `createId` is injectable for the same reason.
 *
 * Each legacy tree moves to a fresh tree id, carrying its pending-removal
 * mark along if it has one, and `treeIdsByLegacyWindowId` reports which id
 * each one got. Every legacy key—including a mark whose tree is already
 * gone—is removed.
 */
export function planLegacyTreeMigration(
  legacyTrees: Map<number, unknown>,
  legacyMarks: Map<number, unknown>,
  createId: () => string = createTreeId,
): {
  toSet: Record<string, unknown>;
  toRemove: string[];
  treeIdsByLegacyWindowId: Map<number, string>;
} {
  const toSet: Record<string, unknown> = {};
  const toRemove: string[] = [];
  const treeIdsByLegacyWindowId = new Map<number, string>();

  for (const [windowId, value] of legacyTrees) {
    const treeId = createId();
    treeIdsByLegacyWindowId.set(windowId, treeId);
    toSet[getStorageKey(treeId)] = value;
    toRemove.push(getLegacyStorageKey(windowId));
  }

  for (const [windowId, mark] of legacyMarks) {
    const treeId = treeIdsByLegacyWindowId.get(windowId);
    if (treeId !== undefined) {
      toSet[getPendingRemovalKey(treeId)] = mark;
    }
    toRemove.push(getLegacyPendingRemovalKey(windowId));
  }

  return { toSet, toRemove, treeIdsByLegacyWindowId };
}

/**
 * Moves trees saved under their window id (`LEGACY_TREE_KEY_PREFIX`) to
 * tree ids of their own (`WINDOW_TREE_KEY_PREFIX`), along with their
 * pending-removal marks. A no-op once nothing is left to migrate, so it's
 * safe to call on every startup.
 *
 * A legacy tree saved under the id of a window that's open right now (e.g.
 * this runs after an in-place extension update, before any restart) is
 * recorded as that window's tree, so it keeps it without needing to be
 * matched by URL again.
 */
export async function migrateLegacyTrees(
  openWindowIds: Iterable<number>,
): Promise<void> {
  const [legacyTrees, legacyMarks] = await Promise.all([
    loadValuesBySuffix(LEGACY_TREE_KEY_PREFIX, parseNonNegativeInteger),
    loadValuesBySuffix(
      PENDING_TREE_REMOVAL_KEY_PREFIX,
      parseNonNegativeInteger,
    ),
  ]);
  if (legacyTrees.size === 0 && legacyMarks.size === 0) {
    return;
  }

  const { toSet, toRemove, treeIdsByLegacyWindowId } = planLegacyTreeMigration(
    legacyTrees,
    legacyMarks,
  );
  // Written before anything is removed, so an interruption partway through
  // can at worst leave a tree migrated twice (the second copy then goes
  // unmatched and is cleaned up like any other), but never lost.
  await chrome.storage.local.set(toSet);

  const open = new Set(openWindowIds);
  await Promise.all(
    treeIdsByLegacyWindowId
      .entries()
      .filter(([windowId]) => open.has(windowId))
      .map(([windowId, treeId]) => saveTreeIdForWindow(windowId, treeId)),
  );

  await chrome.storage.local.remove(toRemove);
}
