/**
 * Messages sent from the side panel to the background service worker for UI-
 * driven tree changes that don't originate from a `chrome.tabs`/`chrome.
 * windows` event (e.g. toggling a node's collapsed state).
 */
export interface ToggleCollapsedMessage {
  type: "toggleCollapsed";
  tabId: number;
}

export type TaborMessage = ToggleCollapsedMessage;
