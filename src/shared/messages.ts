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
  tabId: number;
  target: DropTarget;
}

export type TaborMessage = ToggleCollapsedMessage | MoveNodeMessage;
