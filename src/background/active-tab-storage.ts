import { ACTIVE_TAB_KEY_PREFIX } from "../shared/storage-keys";

function getActiveTabStorageKey(windowId: number): string {
  return `${ACTIVE_TAB_KEY_PREFIX}${windowId}`;
}

/**
 * Persists the active tab id per window to `chrome.storage.session`, so a
 * service worker cold-starting mid-session (see `reloadFromStorage`) can
 * recover which tab was active *before* whichever event woke it up—rather
 * than only being able to query the live, already-moved-on current state,
 * which for a wake-up caused by a new foreground tab's own `onCreated`
 * event is that same new tab, not the one the user was actually on when
 * they opened it.
 *
 * `chrome.storage.session` (not `.local`) since this only matters within a
 * single browser session: an actual browser restart re-derives the active
 * tab correctly from scratch (see `initializeWindow`/`initializeAllWindows`,
 * both called right when window/tab identity is still fresh), and doesn't
 * need this at all.
 */
export async function savePersistedActiveTabId(
  windowId: number,
  tabId: number,
): Promise<void> {
  await chrome.storage.session.set({
    [getActiveTabStorageKey(windowId)]: tabId,
  });
}

/**
 * Load the active tab id persisted by `savePersistedActiveTabId`, or
 * `undefined` if none was saved.
 */
export async function loadPersistedActiveTabId(
  windowId: number,
): Promise<number | undefined> {
  const key = getActiveTabStorageKey(windowId);
  const result = await chrome.storage.session.get(key);
  return result[key] as number | undefined;
}
