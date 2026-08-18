import { pickFocusTarget } from "../shared/tree/focus-target";
import type { TreeState } from "../shared/tree/types";
import { getActiveTabId, getTree } from "./store";

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

// TODO(debug): temporary instrumentation to root-cause an intermittent report
// that closing the active tab from outside Tabor (e.g. another extension
// calling chrome.tabs.remove) sometimes ends up focusing the wrong tab.
// Remove once root-caused.
function debugLog(event: string, data: Record<string, unknown>): void {
  console.log(
    `[Tabor:pending-close] ${event}`,
    JSON.stringify({ ...data, at: Date.now() }),
  );
}

async function flush(windowId: number): Promise<void> {
  const batch = pendingBatches.get(windowId);
  if (batch === undefined) {
    return;
  }
  pendingBatches.delete(windowId);
  clearTimeout(batch.timer);

  const beforeUpdate = await chrome.tabs.query({ active: true, windowId });
  debugLog("flush", {
    windowId,
    activeIdAtStart: batch.activeIdAtStart,
    seenIds: [...batch.seenIds],
    actualActiveTabIdBeforeUpdate: beforeUpdate[0]?.id,
  });

  // Nothing to correct if the tab that was active when the batch started
  // isn't one of the ones actually closed.
  if (
    batch.activeIdAtStart === undefined ||
    !batch.seenIds.has(batch.activeIdAtStart)
  ) {
    debugLog("flush: bailing, active-at-start tab wasn't closed", {
      windowId,
      activeIdAtStart: batch.activeIdAtStart,
    });
    return;
  }

  const target = pickFocusTarget(
    batch.snapshot,
    batch.activeIdAtStart,
    batch.seenIds,
  );
  debugLog("flush: computed target", { windowId, target });
  if (target === undefined) {
    return;
  }

  try {
    await chrome.tabs.update(target, { active: true });
    debugLog("flush: chrome.tabs.update succeeded", { windowId, target });
  } catch (error) {
    debugLog("flush: chrome.tabs.update threw", {
      windowId,
      target,
      error: String(error),
    });
    return;
  }

  // Check back shortly after: did our own activation actually stick, or did
  // something else (Chrome's own default reassignment, another extension)
  // change it again right after?
  setTimeout(() => {
    void (async () => {
      const after = await chrome.tabs.query({ active: true, windowId });
      debugLog("flush: active tab, some time after our update", {
        windowId,
        target,
        actualActiveTabIdAfterDelay: after[0]?.id,
        matchesTarget: after[0]?.id === target,
      });
    })();
  }, 300);
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
      () => void flush(windowId),
      REGISTERED_BATCH_SAFETY_TIMEOUT_MS,
    ),
  });
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
      activeIdAtStart: getActiveTabId(windowId),
      timer: setTimeout(() => void flush(windowId), NATIVE_BATCH_DEBOUNCE_MS),
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
    batch.timer = setTimeout(
      () => void flush(windowId),
      NATIVE_BATCH_DEBOUNCE_MS,
    );
    return;
  }

  const hasSeenAllExpected = [...batch.expectedIds].every((id) =>
    batch.seenIds.has(id),
  );
  if (hasSeenAllExpected) {
    void flush(windowId);
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
