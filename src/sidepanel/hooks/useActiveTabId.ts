import { useEffect, useState } from "react";

// TODO(debug): temporary instrumentation for two intermittent, hard-to-
// reproduce bugs (a stuck loading spinner on an already-loaded tab; a
// missing active-tab indicator after closing the active tab). Remove once
// root-caused. Prefixed and timestamped so its output can be correlated
// with the background service worker's own `[Tabor:background]` logs (a
// separate console—see chrome://extensions's "service worker" link).
function debugLog(event: string, data: Record<string, unknown>): void {
  console.log(`[Tabor:sidepanel] ${event}`, { ...data, at: Date.now() });
}

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
      debugLog("initial query", { windowId: currentWindowId, tabId: tab?.id });
      if (!isCancelled && tab?.id !== undefined) {
        setActiveTabId(tab.id);
      }
    }
    void loadActiveTab();

    const listener = (activeInfo: chrome.tabs.OnActivatedInfo) => {
      debugLog("onActivated", {
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
        matchesCurrentWindow: activeInfo.windowId === currentWindowId,
      });
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
