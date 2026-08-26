import { useEffect, useState } from "react";
import { getStorageKey, loadTree } from "../../shared/tree/storage";
import type { TreeState } from "../../shared/tree/types";

const EMPTY_TREE: TreeState = { nodes: {}, rootIds: [] };

/**
 * The live tree for a window, and whether it's still loading (see
 * `isLoading`).
 */
export interface WindowTree {
  tree: TreeState;
  // True until this window's tree is actually found in storage. A window
  // always has at least one tab, so a saved tree is never genuinely empty—
  // `loadTree` returning `undefined` therefore means the background hasn't
  // finished (re)initializing this window yet (e.g. right after a browser
  // restart, before which window ids—and so this window's storage key—don't
  // exist), not that it has no tabs.
  isLoading: boolean;
}

/**
 * The live tree for the given window.
 */
export function useWindowTree(windowId: number | undefined): WindowTree {
  const [tree, setTree] = useState<TreeState>(EMPTY_TREE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (windowId === undefined) {
      return;
    }

    const currentWindowId = windowId;
    let isCancelled = false;

    async function loadInitialTree() {
      const loaded = await loadTree(currentWindowId);
      if (!isCancelled && loaded !== undefined) {
        setTree(loaded);
        setIsLoading(false);
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
        setIsLoading(false);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);

    return () => {
      isCancelled = true;
      chrome.storage.local.onChanged.removeListener(listener);
    };
  }, [windowId]);

  return { tree, isLoading };
}
