import { useEffect, useState } from "react";
import { getStorageKey, loadTree } from "../../shared/tree/storage";
import type { TreeState } from "../../shared/tree/types";

const EMPTY_TREE: TreeState = { nodes: {}, rootIds: [] };

/**
 * The live tree for the window this side panel is attached to.
 */
export function useWindowTree(): TreeState {
  const [windowId, setWindowId] = useState<number>();
  const [tree, setTree] = useState<TreeState>(EMPTY_TREE);

  useEffect(() => {
    let isCancelled = false;

    async function detectWindowId() {
      const window = await chrome.windows.getCurrent();
      if (!isCancelled && window.id !== undefined) {
        setWindowId(window.id);
      }
    }
    void detectWindowId();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (windowId === undefined) {
      return;
    }

    const currentWindowId = windowId;
    let isCancelled = false;

    async function loadInitialTree() {
      const loaded = await loadTree(currentWindowId);
      if (!isCancelled) {
        setTree(loaded ?? EMPTY_TREE);
      }
    }
    void loadInitialTree();

    const key = getStorageKey(currentWindowId);
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
    ) => {
      const change = changes[key];
      if (change !== undefined) {
        setTree((change.newValue as TreeState | undefined) ?? EMPTY_TREE);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);

    return () => {
      isCancelled = true;
      chrome.storage.local.onChanged.removeListener(listener);
    };
  }, [windowId]);

  return tree;
}
