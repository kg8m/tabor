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

export interface MoveNodeMessage {
  type: "moveNode";
  // A single tab id for a single-node drag, or several for dragging a
  // multi-selection together.
  tabIds: number[];
  target: DropTarget;
}

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

export type TaborMessage =
  | ToggleCollapsedMessage
  | MoveNodeMessage
  | RestoreBackupMessage
  | RegisterPendingCloseMessage
  | UpdateNoteMessage;
