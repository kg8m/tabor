import { useEffect, useState } from "react";

/**
 * The id of the currently active tab in the given window, kept live via
 * `chrome.tabs.onActivated`.
 *
 * Used to hide the suspend button for the active tab: `chrome.tabs.discard`
 * doesn't free any memory there since Chrome has to reload the tab
 * immediately to keep displaying it, so the button would just cost a page
 * reload for no benefit.
 */
export function useActiveTabId(
  windowId: number | undefined,
): number | undefined {
  const [activeTabId, setActiveTabId] = useState<number>();

  useEffect(() => {
    if (windowId === undefined) {
      return;
    }

    const currentWindowId = windowId;
    let isCancelled = false;

    async function loadActiveTab() {
      const [tab] = await chrome.tabs.query({
        active: true,
        windowId: currentWindowId,
      });
      if (!isCancelled && tab?.id !== undefined) {
        setActiveTabId(tab.id);
      }
    }
    void loadActiveTab();

    const listener = (activeInfo: chrome.tabs.OnActivatedInfo) => {
      if (activeInfo.windowId === currentWindowId) {
        setActiveTabId(activeInfo.tabId);
      }
    };
    chrome.tabs.onActivated.addListener(listener);

    return () => {
      isCancelled = true;
      chrome.tabs.onActivated.removeListener(listener);
    };
  }, [windowId]);

  return activeTabId;
}
