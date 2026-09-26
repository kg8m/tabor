import type { DropTarget } from "./tree/mutations";

/**
 * Messages sent from the side panel to the background service worker for UI-
 * driven tree changes that don't originate from a `chrome.tabs`/`chrome.
 * windows` event (e.g. toggling a node's collapsed state, or a drag-and-drop
 * move).
 */
export interface ToggleCollapsedMessage {
  type: "toggleCollapsed";
  tabId: number;
}

/**
 * Move one or more tabs (a single-node drag, or a multi-selection dragged
 * together) to a new position—see `moveNode`/`moveNodes`.
 */
export interface MoveNodeMessage {
  type: "moveNode";
  // A single tab id for a single-node drag, or several for dragging a
  // multi-selection together.
  tabIds: number[];
  target: DropTarget;
}

/**
 * Restore a window's tree to a previously saved backup snapshot.
 */
export interface RestoreBackupMessage {
  type: "restoreBackup";
  windowId: number;
  timestamp: number;
}

/**
 * Declares tabs the side panel is about to close (see `pending-close.ts`),
 * sent before the corresponding `chrome.tabs.remove` call so the background
 * can resolve the next focus target as soon as they've all closed, instead
 * of falling back to debouncing an unregistered close.
 */
export interface RegisterPendingCloseMessage {
  type: "registerPendingClose";
  windowId: number;
  tabIds: number[];
}

/**
 * Set or clear a tab's note (`null` clears it).
 */
export interface UpdateNoteMessage {
  type: "updateNote";
  tabId: number;
  note: string | null;
}

/**
 * Declares tabs the side panel is about to move together to another window
 * (see `ContextMenu`'s "Move tab(s)/tree(s) to window"), sent before the
 * corresponding `chrome.tabs.move`/`chrome.windows.create` calls—see
 * `pending-tree-move.ts`.
 */
export interface RegisterPendingTreeMoveMessage {
  type: "registerPendingTreeMove";
  windowId: number;
  tabIds: number[];
}

/**
 * Remove the saved trees of windows that are no longer open (see
 * `selectOrphanedWindowIds`). Any id in `windowIds` whose window is open
 * again by the time this is handled is left alone.
 */
export interface RemoveSavedTreesMessage {
  type: "removeSavedTrees";
  windowIds: number[];
}

/**
 * The discriminated union of every message the side panel can send the
 * background service worker (see `chrome.runtime.onMessage` in
 * `src/background/index.ts`).
 */
export type TaborMessage =
  | ToggleCollapsedMessage
  | MoveNodeMessage
  | RestoreBackupMessage
  | RegisterPendingCloseMessage
  | UpdateNoteMessage
  | RegisterPendingTreeMoveMessage
  | RemoveSavedTreesMessage;
