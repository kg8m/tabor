import { useEffect, useRef, useState } from "react";
import type { TaborMessage } from "../../shared/messages";
import {
  PENDING_TREE_REMOVAL_KEY_PREFIX,
  TREE_ID_KEY_PREFIX,
  WINDOW_TREE_KEY_PREFIX,
} from "../../shared/storage-keys";
import { selectOrphanedTreeIds } from "../../shared/tree/orphaned-trees";
import {
  loadAllTrees,
  loadPendingRemovals,
  loadTreeIdsByWindowId,
  type StoredTree,
} from "../../shared/tree/storage";
import { queryOpenWindowIds } from "../../shared/windows";
import { formatTimestamp } from "../format";
import { SubviewFrame } from "./SubviewFrame";
import { TreePreview } from "./TreePreview";

interface SavedTreesSubviewProps {
  onClose: () => void;
}

interface OrphanedTree extends StoredTree {
  treeId: string;
  // When `initializeAllWindows` first found it unmatched, if it has.
  pendingRemovalSince: number | undefined;
}

function formatTabCount(count: number): string {
  return count === 1 ? "1 tab" : `${count} tabs`;
}

async function loadOrphanedTrees(): Promise<OrphanedTree[]> {
  const [trees, pendingRemovals, treeIdsByWindowId, openWindowIds] =
    await Promise.all([
      loadAllTrees(),
      loadPendingRemovals(),
      loadTreeIdsByWindowId(),
      queryOpenWindowIds(),
    ]);
  const open = new Set(openWindowIds);
  const heldTreeIds = treeIdsByWindowId
    .entries()
    .filter(([windowId]) => open.has(windowId))
    .map(([, treeId]) => treeId);
  const orphanedTreeIds = selectOrphanedTreeIds(trees.keys(), heldTreeIds);

  return orphanedTreeIds
    .flatMap((treeId) => {
      const stored = trees.get(treeId);
      return stored === undefined
        ? []
        : [
            {
              ...stored,
              treeId,
              pendingRemovalSince: pendingRemovals.get(treeId),
            },
          ];
    })
    .toSorted((a, b) => b.savedAt - a.savedAt);
}

/**
 * Lists the saved trees of windows that aren't open right now (newest save
 * first), lets each be previewed, and removes one on request, for trees the
 * automatic cleanup in `initializeAllWindows` would otherwise keep around
 * for a long time.
 *
 * Reads storage directly, like `BackupHistorySubview`, and reloads whenever a
 * saved tree, pending-removal mark, or window's tree-id record changes, so
 * the list stays current both after a removal here and as windows
 * open/close meanwhile. Removal
 * itself goes through the background service worker (`removeSavedTrees`),
 * the only writer of tree state.
 */
export function SavedTreesSubview({ onClose }: SavedTreesSubviewProps) {
  const [trees, setTrees] = useState<OrphanedTree[] | undefined>(undefined);
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  // Removal asks for confirmation as a second step in the footer, the same
  // way `ContextMenu` does for closing tabs (`window.confirm` is blocked in
  // the side panel). Reset whenever the selection changes, so a confirmation
  // never carries over to a different tree than the one it was asked for.
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
  // Where the most recently removed tree sat in the list, so that with
  // nothing selected afterward, ArrowDown picks the entry that took its
  // place and ArrowUp the one before it—rather than jumping back to the top
  // of the list. Not auto-selecting that entry outright, which would make
  // the next ArrowDown skip past it.
  const [removedIndex, setRemovedIndex] = useState<number | null>(null);
  const itemElements = useRef(new Map<string, HTMLLIElement>());
  const listElement = useRef<HTMLUListElement>(null);

  const select = (treeId: string): void => {
    setSelectedTreeId(treeId);
    setIsConfirmingRemoval(false);
    setRemovedIndex(null);
  };

  useEffect(() => {
    if (selectedTreeId === null) {
      return;
    }
    itemElements.current.get(selectedTreeId)?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedTreeId]);

  useEffect(() => {
    // See `BackupHistorySubview` for why this isn't JSX's `autoFocus`.
    listElement.current?.focus();
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      const loaded = await loadOrphanedTrees();
      if (isCancelled) {
        return;
      }
      setTrees(loaded);
      // Drop the selection once its tree is gone (e.g. just removed).
      setSelectedTreeId((current) =>
        current !== null && loaded.some((tree) => tree.treeId === current)
          ? current
          : null,
      );
    }

    // Also watches which window holds which tree (in session storage), since
    // a window closing or reopening moves a tree onto or off of this list
    // without touching the tree itself.
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
    ): void => {
      if (
        Object.keys(changes).some(
          (key) =>
            key.startsWith(WINDOW_TREE_KEY_PREFIX) ||
            key.startsWith(PENDING_TREE_REMOVAL_KEY_PREFIX) ||
            key.startsWith(TREE_ID_KEY_PREFIX),
        )
      ) {
        void load();
      }
    };

    void load();
    chrome.storage.local.onChanged.addListener(listener);
    chrome.storage.session.onChanged.addListener(listener);

    return () => {
      isCancelled = true;
      chrome.storage.local.onChanged.removeListener(listener);
      chrome.storage.session.onChanged.removeListener(listener);
    };
  }, []);

  const selectedTree = trees?.find((tree) => tree.treeId === selectedTreeId);

  const handleListKeyDown = (
    event: React.KeyboardEvent<HTMLUListElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (trees === undefined || trees.length === 0) {
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    event.preventDefault();

    const currentIndex = trees.findIndex(
      (tree) => tree.treeId === selectedTreeId,
    );
    const isDown = event.key === "ArrowDown";
    let unclampedNextIndex: number;
    if (currentIndex !== -1) {
      unclampedNextIndex = currentIndex + (isDown ? 1 : -1);
    } else if (removedIndex === null) {
      unclampedNextIndex = 0;
    } else {
      unclampedNextIndex = isDown ? removedIndex : removedIndex - 1;
    }
    const nextIndex = Math.min(
      Math.max(unclampedNextIndex, 0),
      trees.length - 1,
    );
    const nextTree = trees[nextIndex];
    if (nextTree === undefined) {
      return;
    }

    select(nextTree.treeId);
  };

  const handlePreviewKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    onClose();
  };

  const handleRemove = (): void => {
    if (selectedTreeId === null) {
      return;
    }

    const message: TaborMessage = {
      type: "removeSavedTrees",
      treeIds: [selectedTreeId],
    };
    void chrome.runtime.sendMessage(message);
    setIsConfirmingRemoval(false);
    const index =
      trees?.findIndex((tree) => tree.treeId === selectedTreeId) ?? -1;
    setRemovedIndex(index === -1 ? null : index);
    // The Remove button that had focus is about to be replaced by
    // "Remove…", so hand focus back to the list for the arrow keys.
    listElement.current?.focus();
  };

  return (
    <SubviewFrame
      title="Closed windows"
      onClose={onClose}
      footer={
        isConfirmingRemoval ? (
          <>
            <span className="saved-trees__confirm-text">
              Remove this saved tree?
            </span>
            <button
              type="button"
              className="subview__secondary-action"
              onClick={() => setIsConfirmingRemoval(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="subview__primary-action"
              onClick={handleRemove}
            >
              Remove
            </button>
          </>
        ) : (
          <button
            type="button"
            className="subview__primary-action"
            disabled={selectedTree === undefined}
            onClick={() => setIsConfirmingRemoval(true)}
          >
            Remove…
          </button>
        )
      }
    >
      <p className="saved-trees__note">
        Saved trees of windows that aren’t open right now. Removing one means
        that window’s tab hierarchy can’t be restored if it’s reopened later.
        This list updates automatically as windows close or reopen.
      </p>
      <ul
        className="subview__list"
        ref={listElement}
        tabIndex={-1}
        onKeyDown={handleListKeyDown}
      >
        {trees === undefined && <li className="subview__empty">Loading...</li>}
        {trees?.length === 0 && (
          <li className="subview__empty">No saved trees of closed windows.</li>
        )}
        {trees?.map((tree) => (
          <li
            key={tree.treeId}
            ref={(element) => {
              if (element) {
                itemElements.current.set(tree.treeId, element);
              } else {
                itemElements.current.delete(tree.treeId);
              }
            }}
          >
            <button
              type="button"
              className={
                "subview__item" +
                (tree.treeId === selectedTreeId
                  ? " subview__item--selected"
                  : "")
              }
              onClick={() => select(tree.treeId)}
            >
              {formatTimestamp(tree.savedAt)}
              <span className="saved-trees__item-detail">
                {formatTabCount(Object.keys(tree.tree.nodes).length)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div
        className="subview__preview"
        // See `BackupHistorySubview` for why this is focusable.
        tabIndex={-1}
        onKeyDown={handlePreviewKeyDown}
      >
        {selectedTree === undefined ? (
          <p className="subview__empty">Select a saved tree to preview it.</p>
        ) : (
          <>
            {selectedTree.pendingRemovalSince !== undefined && (
              <p className="saved-trees__pending">
                Unmatched since{" "}
                {formatTimestamp(selectedTree.pendingRemovalSince)}
              </p>
            )}
            <TreePreview tree={selectedTree.tree} />
          </>
        )}
      </div>
    </SubviewFrame>
  );
}
