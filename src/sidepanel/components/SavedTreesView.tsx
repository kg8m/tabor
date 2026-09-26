import { useEffect, useRef, useState } from "react";
import type { TaborMessage } from "../../shared/messages";
import {
  PENDING_TREE_REMOVAL_KEY_PREFIX,
  TREE_KEY_PREFIX,
} from "../../shared/storage-keys";
import { selectOrphanedWindowIds } from "../../shared/tree/orphaned-trees";
import {
  loadAllTrees,
  loadPendingRemovals,
  type StoredTree,
} from "../../shared/tree/storage";
import { queryOpenWindowIds } from "../../shared/windows";
import { formatTimestamp } from "../format";
import { Subview } from "./Subview";
import { TreePreview } from "./TreePreview";

interface SavedTreesViewProps {
  onClose: () => void;
}

interface OrphanedTree extends StoredTree {
  windowId: number;
  // When `initializeAllWindows` first found it unmatched, if it has.
  pendingRemovalSince: number | undefined;
}

function formatTabCount(count: number): string {
  return count === 1 ? "1 tab" : `${count} tabs`;
}

async function loadOrphanedTrees(): Promise<OrphanedTree[]> {
  const [trees, pendingRemovals, openWindowIds] = await Promise.all([
    loadAllTrees(),
    loadPendingRemovals(),
    queryOpenWindowIds(),
  ]);
  const orphanedWindowIds = selectOrphanedWindowIds(
    Object.keys(trees).map(Number),
    openWindowIds,
  );

  return orphanedWindowIds
    .flatMap((windowId) => {
      const stored = trees[windowId];
      return stored === undefined
        ? []
        : [
            {
              ...stored,
              windowId,
              pendingRemovalSince: pendingRemovals.get(windowId),
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
 * Reads storage directly, like `BackupHistoryView`, and reloads whenever a
 * saved tree or pending-removal mark changes, so the list stays current
 * both after a removal here and as windows open/close meanwhile. Removal
 * itself goes through the background service worker (`removeSavedTrees`),
 * the only writer of tree state.
 */
export function SavedTreesView({ onClose }: SavedTreesViewProps) {
  const [trees, setTrees] = useState<OrphanedTree[] | undefined>(undefined);
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null);
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
  const itemElements = useRef(new Map<number, HTMLLIElement>());
  const listElement = useRef<HTMLUListElement>(null);

  const select = (windowId: number): void => {
    setSelectedWindowId(windowId);
    setIsConfirmingRemoval(false);
    setRemovedIndex(null);
  };

  useEffect(() => {
    if (selectedWindowId === null) {
      return;
    }
    itemElements.current.get(selectedWindowId)?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedWindowId]);

  useEffect(() => {
    // See `BackupHistoryView` for why this isn't JSX's `autoFocus`.
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
      setSelectedWindowId((current) =>
        current !== null && loaded.some((tree) => tree.windowId === current)
          ? current
          : null,
      );
    }

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
    ): void => {
      if (
        Object.keys(changes).some(
          (key) =>
            key.startsWith(TREE_KEY_PREFIX) ||
            key.startsWith(PENDING_TREE_REMOVAL_KEY_PREFIX),
        )
      ) {
        void load();
      }
    };

    void load();
    chrome.storage.local.onChanged.addListener(listener);

    return () => {
      isCancelled = true;
      chrome.storage.local.onChanged.removeListener(listener);
    };
  }, []);

  const selectedTree = trees?.find(
    (tree) => tree.windowId === selectedWindowId,
  );

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
      (tree) => tree.windowId === selectedWindowId,
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

    select(nextTree.windowId);
  };

  const handleRemove = (): void => {
    if (selectedWindowId === null) {
      return;
    }

    const message: TaborMessage = {
      type: "removeSavedTrees",
      windowIds: [selectedWindowId],
    };
    void chrome.runtime.sendMessage(message);
    setIsConfirmingRemoval(false);
    const index =
      trees?.findIndex((tree) => tree.windowId === selectedWindowId) ?? -1;
    setRemovedIndex(index === -1 ? null : index);
    // The Remove button that had focus is about to be replaced by
    // "Remove…", so hand focus back to the list for the arrow keys.
    listElement.current?.focus();
  };

  return (
    <Subview
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
            key={tree.windowId}
            ref={(element) => {
              if (element) {
                itemElements.current.set(tree.windowId, element);
              } else {
                itemElements.current.delete(tree.windowId);
              }
            }}
          >
            <button
              type="button"
              className={
                "subview__item" +
                (tree.windowId === selectedWindowId
                  ? " subview__item--selected"
                  : "")
              }
              onClick={() => select(tree.windowId)}
            >
              {formatTimestamp(tree.savedAt)}
              <span className="saved-trees__item-detail">
                {formatTabCount(Object.keys(tree.tree.nodes).length)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="subview__preview">
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
    </Subview>
  );
}
