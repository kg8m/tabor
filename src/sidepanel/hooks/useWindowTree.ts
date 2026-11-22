import { useMemo, useSyncExternalStore } from "react";
import {
  getStorageKey,
  getTreeIdStorageKey,
  loadTree,
  loadTreeIdForWindow,
  unwrapStoredTree,
} from "../../shared/tree/storage";
import type { TreeState } from "../../shared/tree/types";

const EMPTY_TREE: TreeState = { nodes: {}, rootIds: [] };

/**
 * The live tree for a window, and whether it’s still loading (see
 * `isLoading`).
 */
export interface WindowTree {
  tree: TreeState;
  // True until this window’s tree is actually found in storage. A window
  // always has at least one tab, so a saved tree is never genuinely empty—
  // no tree id recorded for this window yet, or no tree saved under it yet,
  // therefore means the background hasn’t finished (re)initializing this
  // window (e.g. right after a browser restart), not that it has no tabs.
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
 * An external store (for `useSyncExternalStore`) over one window’s tree in
 * `chrome.storage.local`, found via the tree id recorded for the window in
 * `chrome.storage.session` (see `TREE_ID_KEY_PREFIX`)—and followed to a new
 * one whenever that changes, e.g. when the background matches the window to
 * a saved tree. `snapshot` is a plain mutable variable rather than React
 * state—`useSyncExternalStore` requires `getSnapshot` to keep returning the
 * very same reference until the store actually changes, so the update has to
 * happen outside of React’s own state mechanism.
 */
function createWindowTreeStore(windowId: number): {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => WindowTree;
} {
  let snapshot = LOADING_SNAPSHOT;

  return {
    subscribe(onStoreChange) {
      let treeId: string | undefined;
      // Bumped whenever `treeId` changes or a change to its tree arrives, so
      // a `loadTree` resolving late—for a tree id this window has since
      // moved off of, or with a value older than that change—can’t
      // overwrite the newer snapshot. No guard needed against this
      // subscription being torn down, though: each `windowId` gets its own
      // store instance (see `useWindowTree`), so a late resolution can only
      // write into a `snapshot` that nothing reads anymore.
      let generation = 0;

      async function followTreeId(nextTreeId: string | undefined) {
        treeId = nextTreeId;
        generation += 1;
        if (nextTreeId === undefined) {
          return;
        }
        const currentGeneration = generation;
        const loaded = await loadTree(nextTreeId);
        if (loaded === undefined || currentGeneration !== generation) {
          return;
        }

        snapshot = { tree: loaded.tree, isLoading: false };
        onStoreChange();
      }

      async function loadInitialTree() {
        const initialTreeId = await loadTreeIdForWindow(windowId);
        // A session change may already have been followed meanwhile.
        if (generation === 0) {
          await followTreeId(initialTreeId);
        }
      }
      void loadInitialTree();

      const treeIdKey = getTreeIdStorageKey(windowId);
      const sessionListener = (
        changes: Record<string, chrome.storage.StorageChange>,
      ) => {
        const change = changes[treeIdKey];
        if (change !== undefined) {
          void followTreeId(change.newValue as string | undefined);
        }
      };

      const localListener = (
        changes: Record<string, chrome.storage.StorageChange>,
      ) => {
        if (treeId === undefined) {
          return;
        }
        const change = changes[getStorageKey(treeId)];
        if (change === undefined) {
          return;
        }

        // Newer than whatever a still-pending `loadTree` may return.
        generation += 1;
        snapshot = {
          tree:
            change.newValue === undefined
              ? EMPTY_TREE
              : unwrapStoredTree(change.newValue).tree,
          isLoading: false,
        };
        onStoreChange();
      };

      chrome.storage.session.onChanged.addListener(sessionListener);
      chrome.storage.local.onChanged.addListener(localListener);

      return () => {
        chrome.storage.session.onChanged.removeListener(sessionListener);
        chrome.storage.local.onChanged.removeListener(localListener);
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
