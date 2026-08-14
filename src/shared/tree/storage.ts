import type { TreeState } from "./types";

const KEY_PREFIX = "tabor:tree:";

export function getStorageKey(windowId: number): string {
  return `${KEY_PREFIX}${windowId}`;
}

export async function saveTree(
  windowId: number,
  tree: TreeState,
): Promise<void> {
  await chrome.storage.local.set({ [getStorageKey(windowId)]: tree });
}

export async function loadTree(
  windowId: number,
): Promise<TreeState | undefined> {
  const key = getStorageKey(windowId);
  const result = await chrome.storage.local.get(key);
  return result[key] as TreeState | undefined;
}

/**
 * Remove the saved tree for a window, e.g. once it's confirmed closed.
 */
export async function removeTree(windowId: number): Promise<void> {
  await chrome.storage.local.remove(getStorageKey(windowId));
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
    trees[windowId] = value as TreeState;
  }

  return trees;
}
