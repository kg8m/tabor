import { useMemo, useSyncExternalStore } from "react";

// TODO(debug): temporary instrumentation for two intermittent, hard-to-
// reproduce bugs (a stuck loading spinner on an already-loaded tab; a
// missing active-tab indicator after closing the active tab). Remove once
// root-caused. Prefixed and timestamped so its output can be correlated
// with the background service worker’s own `[Tabor:background]` logs (a
// separate console—see chrome://extensions’s “service worker” link).
function debugLog(event: string, data: Record<string, unknown>): void {
  console.log(`[Tabor:sidepanel] ${event}`, { ...data, at: Date.now() });
}

function noop(): void {}

function noopSubscribe(): () => void {
  return noop;
}

function getUndefinedSnapshot(): undefined {
  return;
}

/**
 * An external store (for `useSyncExternalStore`) over the active tab id of
 * one window. `activeTabId` is a plain mutable variable rather than React
 * state—`useSyncExternalStore` requires `getSnapshot` to keep returning the
 * very same value until the store actually changes, so the update has to
 * happen outside of React’s own state mechanism.
 */
function createActiveTabIdStore(windowId: number): {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => number | undefined;
} {
  let activeTabId: number | undefined;

  return {
    subscribe(onStoreChange) {
      // No cancellation guard needed for `loadActiveTab`’s result—see the
      // matching comment in `useWindowTree`’s store.
      async function loadActiveTab() {
        const [tab] = await chrome.tabs.query({
          active: true,
          windowId,
        });
        debugLog("initial query", { windowId, tabId: tab?.id });
        if (tab?.id === undefined) {
          return;
        }

        activeTabId = tab.id;
        onStoreChange();
      }
      void loadActiveTab();

      const listener = (activeInfo: chrome.tabs.OnActivatedInfo) => {
        debugLog("onActivated", {
          tabId: activeInfo.tabId,
          windowId: activeInfo.windowId,
          matchesCurrentWindow: activeInfo.windowId === windowId,
        });
        if (activeInfo.windowId !== windowId) {
          return;
        }

        activeTabId = activeInfo.tabId;
        onStoreChange();
      };
      chrome.tabs.onActivated.addListener(listener);

      return () => {
        chrome.tabs.onActivated.removeListener(listener);
      };
    },
    getSnapshot() {
      return activeTabId;
    },
  };
}

/**
 * The id of the currently active tab in the given window, kept live via
 * `chrome.tabs.onActivated`.
 *
 * Used to hide the suspend button for the active tab: `chrome.tabs.discard`
 * doesn’t free any memory there since Chrome has to reload the tab
 * immediately to keep displaying it, so the button would just cost a page
 * reload for no benefit.
 */
export function useActiveTabId(
  windowId: number | undefined,
): number | undefined {
  const store = useMemo(
    () =>
      windowId === undefined ? undefined : createActiveTabIdStore(windowId),
    [windowId],
  );

  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? getUndefinedSnapshot,
  );
}
