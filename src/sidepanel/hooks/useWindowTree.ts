import { useMemo, useSyncExternalStore } from "react";
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

const LOADING_SNAPSHOT: WindowTree = { tree: EMPTY_TREE, isLoading: true };

function noop(): void {}

function noopSubscribe(): () => void {
  return noop;
}

function getLoadingSnapshot(): WindowTree {
  return LOADING_SNAPSHOT;
}

/**
 * An external store (for `useSyncExternalStore`) over one window's tree in
 * `chrome.storage.local`. `snapshot` is a plain mutable variable rather than
 * React state—`useSyncExternalStore` requires `getSnapshot` to keep
 * returning the very same reference until the store actually changes, so
 * the update has to happen outside of React's own state mechanism.
 */
function createWindowTreeStore(windowId: number): {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => WindowTree;
} {
  let snapshot = LOADING_SNAPSHOT;

  return {
    subscribe(onStoreChange) {
      // No cancellation guard needed for `loadInitialTree`'s result: each
      // `windowId` gets its own store instance (see `useWindowTree`), so a
      // resolution arriving after this subscription is torn down can only
      // write into a `snapshot` that nothing reads anymore—`getSnapshot`
      // always reads whichever store `useSyncExternalStore` is currently
      // holding, never this one once it's replaced.
      async function loadInitialTree() {
        const loaded = await loadTree(windowId);
        if (loaded !== undefined) {
          snapshot = { tree: loaded, isLoading: false };
          onStoreChange();
        }
      }
      void loadInitialTree();

      const key = getStorageKey(windowId);
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
      ) => {
        const change = changes[key];
        if (change !== undefined) {
          snapshot = {
            tree: (change.newValue as TreeState | undefined) ?? EMPTY_TREE,
            isLoading: false,
          };
          onStoreChange();
        }
      };
      chrome.storage.local.onChanged.addListener(listener);

      return () => {
        chrome.storage.local.onChanged.removeListener(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

/**
 * The live tree for the given window.
 */
export function useWindowTree(windowId: number | undefined): WindowTree {
  const store = useMemo(
    () =>
      windowId === undefined ? undefined : createWindowTreeStore(windowId),
    [windowId],
  );

  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? getLoadingSnapshot,
  );
}
