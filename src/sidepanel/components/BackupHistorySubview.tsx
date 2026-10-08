import { useEffect, useRef, useState } from "react";
import type { TaborMessage } from "../../shared/messages";
import { BACKUP_KEY_PREFIX } from "../../shared/storage-keys";
import { isTaborOwnTab, toActualTab } from "../../shared/tabs";
import { loadAllBackups, type BackupSnapshot } from "../../shared/tree/backup";
import type { ActualTab } from "../../shared/tree/restore";
import {
  matchWindows,
  type SavedWindow,
} from "../../shared/tree/window-matching";
import { formatTimestamp } from "../format";
import { SubviewFrame } from "./SubviewFrame";
import { TreePreview } from "./TreePreview";

interface BackupHistorySubviewProps {
  windowId: number | undefined;
  onClose: () => void;
}

/**
 * Lists every saved backup snapshot (newest first), lets the current
 * window’s tree at a chosen point be previewed, and restores it on request.
 * Reading the snapshots directly via `loadAllBackups` rather than through
 * the background service worker: `chrome.storage` is available in every
 * extension context, so there’s nothing background-only about a read.
 * Reloads whenever a backup is saved or removed, like `SavedTreesSubview`.
 * Restoring goes through the background service worker instead (see
 * `restoreBackup` message), since only it holds the live in-memory tree
 * store `setTree` needs to update in place, and it alone can safely
 * re-sync the native tab order afterward.
 */
export function BackupHistorySubview({
  windowId,
  onClose,
}: BackupHistorySubviewProps) {
  const [backups, setBackups] = useState<BackupSnapshot[] | undefined>(
    undefined,
  );
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(
    null,
  );
  // Used (via `matchWindows`, below) to find which of a backup’s saved
  // windows is actually this one: a backup’s own window ids can’t be looked
  // up directly, since—like tab ids—they don’t survive a browser restart.
  const [actualTabs, setActualTabs] = useState<ActualTab[] | undefined>(
    undefined,
  );
  const itemElements = useRef(new Map<number, HTMLLIElement>());
  const listElement = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (selectedTimestamp === null) {
      return;
    }
    itemElements.current.get(selectedTimestamp)?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedTimestamp]);

  useEffect(() => {
    // JSX’s `autoFocus` prop isn’t reliable here: this panel mounts from a
    // click on the history button in `App.tsx`, and that button keeps the
    // browser’s default click-to-focus outcome unless focus is moved away
    // from it explicitly, after the DOM has actually committed.
    listElement.current?.focus();
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      const loaded = await loadAllBackups();
      loaded.sort((a, b) => b.timestamp - a.timestamp);
      if (isCancelled) {
        return;
      }
      setBackups(loaded);
      // Drop the selection once its backup is gone (e.g. thinned out by
      // `selectBackupTimestampsToKeep`).
      setSelectedTimestamp((current) =>
        current !== null &&
        loaded.some((backup) => backup.timestamp === current)
          ? current
          : null,
      );
    }

    // Reloads as the periodic alarm saves a new snapshot or thins out old
    // ones, so the list stays current while this subview is open.
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
    ): void => {
      if (
        Object.keys(changes).some((key) => key.startsWith(BACKUP_KEY_PREFIX))
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
            id: savedWindowId,
            tree,
            // The whole snapshot was saved at once, so every window in it
            // shares this same `savedAt`—see `matchWindows`’s use of it.
            savedAt: selectedBackup.timestamp,
          }));
          const [match] = matchWindows(savedWindows, [
            { windowId, tabs: actualTabs },
          ]);
          return match?.savedTree;
        })();

  const handleListKeyDown = (
    event: React.KeyboardEvent<HTMLUListElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (backups === undefined || backups.length === 0) {
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    event.preventDefault();

    const currentIndex = backups.findIndex(
      (backup) => backup.timestamp === selectedTimestamp,
    );
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      currentIndex === -1
        ? 0
        : Math.min(Math.max(currentIndex + delta, 0), backups.length - 1);
    const nextBackup = backups[nextIndex];
    if (nextBackup === undefined) {
      return;
    }

    setSelectedTimestamp(nextBackup.timestamp);
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
    <SubviewFrame
      title="Backup history"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="subview__primary-action"
          disabled={selectedTimestamp === null}
          onClick={handleRestore}
        >
          Restore
        </button>
      }
    >
      <p className="backup-history__note">
        A backup of the open windows’ trees is taken every 5 minutes. This list
        updates automatically.
      </p>
      <ul
        className="subview__list"
        ref={listElement}
        tabIndex={-1}
        onKeyDown={handleListKeyDown}
      >
        {backups === undefined && (
          <li className="subview__empty">Loading...</li>
        )}
        {backups?.length === 0 && (
          <li className="subview__empty">No backups yet.</li>
        )}
        {backups?.map((backup, index) => (
          <li
            key={backup.timestamp}
            ref={(element) => {
              if (element) {
                itemElements.current.set(backup.timestamp, element);
              } else {
                itemElements.current.delete(backup.timestamp);
              }
            }}
          >
            <button
              type="button"
              className={
                "subview__item" +
                (backup.timestamp === selectedTimestamp
                  ? " subview__item--selected"
                  : "")
              }
              onClick={() => setSelectedTimestamp(backup.timestamp)}
            >
              <span className="backup-history__item-index">{index + 1}</span>
              {formatTimestamp(backup.timestamp)}
            </button>
          </li>
        ))}
      </ul>
      <div
        className="subview__preview"
        // Focusable even when it doesn’t overflow, so a click on it still
        // keeps focus inside the subview for Escape to reach.
        tabIndex={-1}
        onKeyDown={handlePreviewKeyDown}
      >
        {selectedTimestamp === null ? (
          <p className="subview__empty">Select a backup to preview it.</p>
        ) : previewTree === undefined ? (
          <p className="subview__empty">Loading...</p>
        ) : (
          <TreePreview tree={previewTree} />
        )}
      </div>
    </SubviewFrame>
  );
}
