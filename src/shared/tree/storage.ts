import type { TreeState } from "./types";

function getStorageKey(windowId: number): string {
  return `tabor:tree:${windowId}`;
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
