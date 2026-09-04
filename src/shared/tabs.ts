import type { ActualTab } from "./tree/restore";

// Vivaldi (unlike Chrome) surfaces the side panel's own document as a real
// tab—it shows up in `chrome.tabs.query`/`onCreated` alongside the user's
// actual tabs, under this URL. Tabor has no business tracking itself as a
// node in its own tree, so callers filter tabs against this before handing
// them to the tree logic.
export const TABOR_SIDE_PANEL_URL = chrome.runtime.getURL(
  "src/sidepanel/index.html",
);

/**
 * Whether `tab` is Tabor's own side panel document rather than a tab it
 * should track—see `TABOR_SIDE_PANEL_URL`.
 */
export function isTaborOwnTab(tab: chrome.tabs.Tab): boolean {
  return tab.url === TABOR_SIDE_PANEL_URL;
}

/**
 * Chrome sometimes reports a favicon that hasn't loaded yet as an empty
 * string rather than omitting the field; treated the same as "none yet" (an
 * `<img src="">` would otherwise re-request the current page).
 *
 * For a `file://` tab, Chrome reports a `file://` favicon URL too—but the
 * side panel is an extension page, which isn't allowed to load `file://`
 * resources, so rendering it as an `<img src>` just logs a console error
 * ("Not allowed to load local resource"). Treated the same as "none" so it
 * falls back to the default icon instead.
 */
export function normalizeFavIconUrl(
  favIconUrl: string | undefined,
): string | undefined {
  if (!favIconUrl || favIconUrl.startsWith("file://")) {
    return undefined;
  }
  return favIconUrl;
}

/**
 * Whether `tab` should render as suspended. `discarded` alone only reports a
 * tab that was loaded and later unloaded again—it says nothing about one
 * that hasn't loaded at all yet, e.g. a non-active tab Chrome just
 * recreated from session restore or a window reopen and hasn't loaded
 * because it's never been clicked. Chrome's `status` has a separate
 * `"unloaded"` value (`chrome.tabs.TabStatus.UNLOADED`) for exactly that
 * case, distinct from `discarded`—so both are treated as suspended here.
 */
export function isTabSuspended(tab: chrome.tabs.Tab): boolean {
  return tab.discarded || tab.status === "unloaded";
}

/**
 * Convert a `chrome.tabs.Tab` into the plain shape the tree logic works with.
 */
export function toActualTab(tab: chrome.tabs.Tab): ActualTab {
  return {
    id: tab.id ?? -1,
    url: tab.url ?? tab.pendingUrl ?? "",
    title: tab.title ?? "",
    favIconUrl: normalizeFavIconUrl(tab.favIconUrl),
    pinned: tab.pinned,
    loading: tab.status === "loading",
    suspended: isTabSuspended(tab),
    audible: tab.audible ?? false,
  };
}
