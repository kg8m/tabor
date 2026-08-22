import { pickFocusTarget } from "../shared/tree/focus-target";
import type { TreeState } from "../shared/tree/types";
import { getActiveTabId, getPreviousActiveTabId, getTree } from "./store";

// How long to wait, after the last unregistered `onRemoved` for a window, for
// more to arrive before deciding the focus target — covers a close initiated
// outside Tabor (e.g. a native multi-selection close on the tab strip), where
// the full set of tabs being closed together isn't known upfront.
const NATIVE_BATCH_DEBOUNCE_MS = 50;

// A registered batch (see `registerPendingClose`) normally flushes the
// moment every expected id has been seen; this just bounds how long a batch
// can linger if, for whatever reason, some expected `onRemoved` never
// arrives.
const REGISTERED_BATCH_SAFETY_TIMEOUT_MS = 500;

interface PendingBatch {
  // The full set of tabs Tabor itself is about to close (see
  // `registerPendingClose`), or `null` when the batch was discovered
  // reactively from an `onRemoved` Tabor didn't initiate — in that case its
  // membership is grown by debouncing further events instead.
  expectedIds: Set<number> | null;
  seenIds: Set<number>;
  snapshot: TreeState;
  activeIdAtStart: number | undefined;
  timer: ReturnType<typeof setTimeout>;
}

const pendingBatches = new Map<number, PendingBatch>();

function flush(windowId: number): void {
  const batch = pendingBatches.get(windowId);
  if (batch === undefined) {
    return;
  }
  pendingBatches.delete(windowId);
  clearTimeout(batch.timer);

  // Nothing to correct if the tab that was active when the batch started
  // isn't one of the ones actually closed.
  if (
    batch.activeIdAtStart === undefined ||
    !batch.seenIds.has(batch.activeIdAtStart)
  ) {
    return;
  }

  const target = pickFocusTarget(
    batch.snapshot,
    batch.activeIdAtStart,
    batch.seenIds,
  );
  if (target !== undefined) {
    void chrome.tabs.update(target, { active: true });
  }
}

/**
 * Declares tabs about to be closed by a Tabor-initiated action (the per-row
 * close button, "Close tree", or a multi-selection close), before
 * `chrome.tabs.remove` is called for them. Letting `noteTabRemoved` know the
 * full set upfront means it can resolve the focus target the moment all of
 * their `onRemoved` events have arrived, rather than waiting out
 * `NATIVE_BATCH_DEBOUNCE_MS` as it would for a close Tabor didn't see coming.
 */
export function registerPendingClose(windowId: number, tabIds: number[]): void {
  const existing = pendingBatches.get(windowId);
  if (existing !== undefined) {
    // A batch for this window is already pending — either an earlier
    // registration awaiting its `onRemoved` events (merge the new ids in),
    // or a native one already under way (leave its snapshot as-is; it'll
    // resolve on its own debounce).
    if (existing.expectedIds !== null) {
      for (const id of tabIds) {
        existing.expectedIds.add(id);
      }
    }
    return;
  }

  pendingBatches.set(windowId, {
    expectedIds: new Set(tabIds),
    seenIds: new Set(),
    snapshot: getTree(windowId),
    activeIdAtStart: getActiveTabId(windowId),
    timer: setTimeout(
      () => flush(windowId),
      REGISTERED_BATCH_SAFETY_TIMEOUT_MS,
    ),
  });
}

/**
 * The active tab as it stood right before `tabId`'s close, for a close
 * Tabor didn't see coming (no `registerPendingClose`). Closing the active
 * tab natively fires `tabs.onActivated` for Chrome's own replacement pick
 * before `tabs.onRemoved` for the closed tab, so `getActiveTabId` alone
 * would already reflect the replacement rather than `tabId` itself in that
 * case—fall back to the previously-active tab when that's what happened.
 */
function activeTabIdBeforeClose(
  windowId: number,
  tabId: number,
): number | undefined {
  const current = getActiveTabId(windowId);
  if (current === tabId) {
    return current;
  }

  const previous = getPreviousActiveTabId(windowId);
  return previous === tabId ? previous : current;
}

/**
 * Records that `tabId` was just closed in `windowId`, ahead of `removeTab`
 * mutating the tree — the first call for a fresh batch captures the tree as
 * it stood right before any of the batch's removals. Must be paired with a
 * `settlePendingClose` call once this tab's own tree update has been saved.
 */
export function noteTabRemoved(windowId: number, tabId: number): void {
  let batch = pendingBatches.get(windowId);
  if (batch === undefined) {
    batch = {
      expectedIds: null,
      seenIds: new Set(),
      snapshot: getTree(windowId),
      activeIdAtStart: activeTabIdBeforeClose(windowId, tabId),
      timer: setTimeout(() => flush(windowId), NATIVE_BATCH_DEBOUNCE_MS),
    };
    pendingBatches.set(windowId, batch);
  }
  batch.seenIds.add(tabId);
}

/**
 * Flushes a registered batch once every expected id has been seen, or
 * extends an unregistered one's debounce window to keep coalescing a burst
 * of native `onRemoved` events into one decision.
 */
export function settlePendingClose(windowId: number): void {
  const batch = pendingBatches.get(windowId);
  if (batch === undefined) {
    return;
  }

  if (batch.expectedIds === null) {
    clearTimeout(batch.timer);
    batch.timer = setTimeout(() => flush(windowId), NATIVE_BATCH_DEBOUNCE_MS);
    return;
  }

  const hasSeenAllExpected = [...batch.expectedIds].every((id) =>
    batch.seenIds.has(id),
  );
  if (hasSeenAllExpected) {
    flush(windowId);
  }
}

/**
 * Drops any pending batch for a window that's being torn down.
 */
export function clearPendingClose(windowId: number): void {
  const batch = pendingBatches.get(windowId);
  if (batch !== undefined) {
    clearTimeout(batch.timer);
    pendingBatches.delete(windowId);
  }
}
