import type { TaborMessage } from "../shared/messages";

/**
 * Closes the given tabs, registering them as a Tabor-initiated close first
 * (see `RegisterPendingCloseMessage`) so the background can resolve the next
 * focus target as soon as every `onRemoved` for the batch has arrived,
 * instead of falling back to debouncing an unregistered close. Shared by
 * `TabNodeRow`'s own close button and `ContextMenu`'s "Close"/"Close tree".
 */
export async function closeTabs(
  windowId: number | undefined,
  tabIds: number[],
): Promise<void> {
  if (windowId !== undefined) {
    const message: TaborMessage = {
      type: "registerPendingClose",
      windowId,
      tabIds,
    };
    await chrome.runtime.sendMessage(message);
  }
  await chrome.tabs.remove(tabIds);
}
