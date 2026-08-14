import type { ActualTab } from "../shared/tree/restore";

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
