import { isTabSuspended, normalizeFavIconUrl } from "../shared/tabs";
import type { TabUpdate } from "../shared/tree/mutations";

/**
 * A snapshot of `tab`'s own state, safe to apply whenever there's no more
 * specific delta to go on (e.g. re-checking a tab on activation, or an
 * `onUpdated` event that isn't itself reporting a status change).
 *
 * `loading` is only ever *cleared* here, never set: some pages (observed on
 * Google Drive, likely due to their own continuous background activity, and
 * separately on a tab reactivated right after closing one opened from it)
 * can leave `tab.status` reading "loading" well past the point the page is
 * genuinely done, with no further status change ever arriving to correct
 * it. Trusting that snapshot to *set* `loading` would latch onto it
 * indefinitely; trusting it only to clear a stuck `loading` still lets a
 * missed completion event (e.g. the service worker was asleep for it)
 * self-correct, without that self-healing creating the exact same kind of
 * stuck spinner it's meant to fix.
 *
 * `suspended` and `audible` have no such asymmetry concern (there's no
 * "stuck" failure mode for either to guard against) and are simply read from
 * the live `tab.discarded`/`tab.audible` (see `isTabSuspended` for why
 * `suspended` also considers `tab.status`, not just `discarded`).
 */
export function toSelfHealingUpdate(tab: chrome.tabs.Tab): TabUpdate {
  const update: TabUpdate = {
    suspended: isTabSuspended(tab),
    audible: tab.audible ?? false,
  };
  if (tab.status === "complete") {
    update.loading = false;
  }
  return update;
}

/**
 * `loading` trusts `changeInfo.status` when this particular event actually
 * reports a status transition—that's the authoritative signal for it—falling
 * back to `toSelfHealingUpdate`'s clear-only snapshot otherwise.
 */
export function toTabUpdate(
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
): TabUpdate {
  const update = toSelfHealingUpdate(tab);
  if (changeInfo.url !== undefined) {
    update.url = changeInfo.url;
  }
  if (changeInfo.title !== undefined) {
    update.title = changeInfo.title;
  }
  if (changeInfo.favIconUrl !== undefined) {
    const normalized = normalizeFavIconUrl(changeInfo.favIconUrl);
    // Chrome can report an empty favIconUrl mid-discard (e.g. suspending a
    // tab) with no accompanying navigation; treating that as "clear it" would
    // wipe out a favicon that's still perfectly valid. Only clear when a URL
    // change accompanies it—there, the old favicon really is stale.
    if (normalized !== undefined || changeInfo.url !== undefined) {
      update.favIconUrl = normalized;
    }
  }
  if (changeInfo.status !== undefined) {
    update.loading = changeInfo.status === "loading";
  }
  if (changeInfo.pinned !== undefined) {
    update.pinned = changeInfo.pinned;
  }
  return update;
}
