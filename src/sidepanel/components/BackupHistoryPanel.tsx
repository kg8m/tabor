import { useEffect, useState } from "react";
import type { TaborMessage } from "../../shared/messages";
import { isTaborOwnTab, toActualTab } from "../../shared/tabs";
import { loadAllBackups, type BackupSnapshot } from "../../shared/tree/backup";
import {
  getChildren,
  getPinnedNodes,
  getUnpinnedRootNodes,
} from "../../shared/tree/queries";
import type { ActualTab } from "../../shared/tree/restore";
import type { TreeState } from "../../shared/tree/types";
import {
  matchWindows,
  type SavedWindow,
} from "../../shared/tree/window-matching";
import { CloseIcon, DefaultFaviconIcon } from "./icons";

interface BackupHistoryPanelProps {
  windowId: number | undefined;
  onClose: () => void;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
    date,
  );
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} (${weekday}) ${hours}:${minutes}`;
}

/**
 * Lists every saved backup snapshot (newest first), lets the current
 * window's tree at a chosen point be previewed, and restores it on request.
 * Reading the snapshots directly via `loadAllBackups` rather than through
 * the background service worker: `chrome.storage` is available in every
 * extension context, so there's nothing background-only about a read.
 * Restoring goes through the background service worker instead (see
 * `restoreBackup` message), since only it holds the live in-memory tree
 * store `setTree` needs to update in place, and it alone can safely
 * re-sync the native tab order afterward.
 */
export function BackupHistoryPanel({
  windowId,
  onClose,
}: BackupHistoryPanelProps) {
  const [backups, setBackups] = useState<BackupSnapshot[] | undefined>(
    undefined,
  );
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(
    null,
  );
  // Used (via `matchWindows`, below) to find which of a backup's saved
  // windows is actually this one: a backup's own window ids can't be looked
  // up directly, since—like tab ids—they don't survive a browser restart.
  const [actualTabs, setActualTabs] = useState<ActualTab[] | undefined>(
    undefined,
  );

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      const loaded = await loadAllBackups();
      loaded.sort((a, b) => b.timestamp - a.timestamp);
      if (!isCancelled) {
        setBackups(loaded);
      }
    }
    void load();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (windowId === undefined) {
      return;
    }

    let isCancelled = false;

    async function load() {
      const tabs = await chrome.tabs.query({ windowId });
      if (!isCancelled) {
        setActualTabs(
          tabs
            .filter((tab) => !isTaborOwnTab(tab))
            .map((tab) => toActualTab(tab)),
        );
      }
    }
    void load();

    return () => {
      isCancelled = true;
    };
  }, [windowId]);

  const selectedBackup = backups?.find(
    (backup) => backup.timestamp === selectedTimestamp,
  );
  const previewTree =
    windowId === undefined ||
    selectedBackup === undefined ||
    actualTabs === undefined
      ? undefined
      : (() => {
          const savedWindows: SavedWindow[] = Object.entries(
            selectedBackup.windows,
          ).map(([savedWindowId, tree]) => ({
            windowId: Number(savedWindowId),
            tree,
            // The whole snapshot was saved at once, so every window in it
            // shares this same `savedAt`—see `matchWindows`'s use of it.
            savedAt: selectedBackup.timestamp,
          }));
          const [match] = matchWindows(savedWindows, [
            { windowId, tabs: actualTabs },
          ]);
          return match?.savedTree;
        })();

  const handleRestore = (): void => {
    if (windowId === undefined || selectedTimestamp === null) {
      return;
    }

    const message: TaborMessage = {
      type: "restoreBackup",
      windowId,
      timestamp: selectedTimestamp,
    };
    void chrome.runtime.sendMessage(message);
    onClose();
  };

  return (
    <div className="backup-history">
      <div className="backup-history__header">
        <h2 className="backup-history__title">Backup history</h2>
        <button
          type="button"
          className="backup-history__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="backup-history__body">
        <ul className="backup-history__list">
          {backups === undefined && (
            <li className="backup-history__empty">Loading...</li>
          )}
          {backups?.length === 0 && (
            <li className="backup-history__empty">No backups yet.</li>
          )}
          {backups?.map((backup, index) => (
            <li key={backup.timestamp}>
              <button
                type="button"
                className={
                  "backup-history__item" +
                  (backup.timestamp === selectedTimestamp
                    ? " backup-history__item--selected"
                    : "")
                }
                onClick={() => setSelectedTimestamp(backup.timestamp)}
              >
                <span className="backup-history__item-index">
                  {index + 1}
                </span>
                {formatTimestamp(backup.timestamp)}
              </button>
            </li>
          ))}
        </ul>
        <div className="backup-history__preview">
          {selectedTimestamp === null ? (
            <p className="backup-history__empty">
              Select a backup to preview it.
            </p>
          ) : previewTree === undefined ? (
            <p className="backup-history__empty">Loading...</p>
          ) : (
            <BackupPreviewTree tree={previewTree} />
          )}
        </div>
      </div>
      <div className="backup-history__footer">
        <button
          type="button"
          className="backup-history__restore"
          disabled={selectedTimestamp === null}
          onClick={handleRestore}
        >
          Restore
        </button>
      </div>
    </div>
  );
}

function BackupPreviewTree({ tree }: { tree: TreeState }) {
  const pinnedNodes = getPinnedNodes(tree);
  const rootNodes = getUnpinnedRootNodes(tree);

  if (pinnedNodes.length === 0 && rootNodes.length === 0) {
    return <p className="backup-history__empty">No tabs in this window.</p>;
  }

  return (
    <ul className="backup-history__preview-tree">
      {[...pinnedNodes, ...rootNodes].map((node) => (
        <BackupPreviewNode key={node.id} tree={tree} nodeId={node.id} />
      ))}
    </ul>
  );
}

function BackupPreviewNode({
  tree,
  nodeId,
}: {
  tree: TreeState;
  nodeId: number;
}) {
  const node = tree.nodes[nodeId];
  if (node === undefined) {
    return null;
  }

  const children = getChildren(tree, nodeId);

  return (
    <li className="backup-history__preview-item">
      <div className="backup-history__preview-row">
        {node.favIconUrl ? (
          <img
            className="backup-history__preview-favicon"
            src={node.favIconUrl}
            alt=""
          />
        ) : (
          <span className="backup-history__preview-favicon backup-history__preview-favicon--default">
            <DefaultFaviconIcon />
          </span>
        )}
        <span className="backup-history__preview-title">{node.title}</span>
      </div>
      {children.length > 0 && (
        <ul className="backup-history__preview-children">
          {children.map((child) => (
            <BackupPreviewNode key={child.id} tree={tree} nodeId={child.id} />
          ))}
        </ul>
      )}
    </li>
  );
}
