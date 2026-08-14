import type { ActualTab } from "../shared/tree/restore";

// Vivaldi (unlike Chrome) surfaces the side panel's own document as a real
// tab—it shows up in `chrome.tabs.query`/`onCreated` alongside the user's
// actual tabs, under this URL. Tabor has no business tracking itself as a
// node in its own tree, so callers filter tabs against this before handing
// them to the tree logic.
export const TABOR_SIDE_PANEL_URL = chrome.runtime.getURL(
  "src/sidepanel/index.html",
);

export function isTaborOwnTab(tab: chrome.tabs.Tab): boolean {
  return tab.url === TABOR_SIDE_PANEL_URL;
}

/**
 * Convert a `chrome.tabs.Tab` into the plain shape the tree logic works with.
 */
export function toActualTab(tab: chrome.tabs.Tab): ActualTab {
  return {
    id: tab.id ?? -1,
    url: tab.url ?? tab.pendingUrl ?? "",
    title: tab.title ?? "",
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned,
    loading: tab.status === "loading",
    suspended: tab.discarded,
  };
}
