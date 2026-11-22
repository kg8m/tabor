import {
  loadPersistedActiveTabId,
  savePersistedActiveTabId,
} from "./active-tab-storage";
import {
  loadBackup,
  loadBackupTimestamps,
  removeBackups,
  saveBackup,
  selectBackupTimestampsToKeep,
} from "../shared/tree/backup";
import {
  addTab,
  moveNodes,
  removeTab,
  reorderFromNativeMove,
  reorderFromPinnedChange,
  replaceTabId,
  updateTab,
  type DropTarget,
} from "../shared/tree/mutations";
import type { TaborMessage } from "../shared/messages";
import {
  DEBUG_LOG_KEY_PREFIX,
  NORMAL_WINDOWS_GAP_KEY,
  SESSION_RECONCILED_KEY,
  selectMalformedKeys,
} from "../shared/storage-keys";
import { selectOrphanedTreeIds } from "../shared/tree/orphaned-trees";
import {
  flattenDepthFirst,
  getNativeOrder,
  getPinnedNodes,
  hasTaborSpecificInfo,
} from "../shared/tree/queries";
import {
  clearPendingClose,
  noteTabRemoved,
  registerPendingClose,
  settlePendingClose,
} from "./pending-close";
import {
  noteTreeMoveAttached,
  registerPendingTreeMove,
} from "./pending-tree-move";
import {
  createRestoreSession,
  matchStraggler,
  restoreTree,
} from "../shared/tree/restore";
import {
  clearPendingRemoval,
  createTreeId,
  loadAllTrees,
  loadPendingRemovals,
  loadTreeIdsByWindowId,
  markPendingRemoval,
  migrateLegacyTrees,
  removeTree,
  removeTreeIdForWindow,
  saveTree,
  saveTreeIdForWindow,
  type WindowType,
} from "../shared/tree/storage";
import type { TreeState } from "../shared/tree/types";
import {
  matchWindows,
  type ActualWindow,
  type SavedWindow,
} from "../shared/tree/window-matching";
import {
  waitForTabCreationToFullySettle,
  waitForTabCreationToSettle,
} from "./settle";
import {
  clearDeletedWindow,
  deleteWindow,
  getActiveTabId,
  getAllTreeIds,
  getAllTrees,
  getRestoreSession,
  getTree,
  getTreeId,
  getWindowType,
  isDeletedWindow,
  isIncognitoWindow,
  removeRestoreSession,
  setActiveTabId,
  setIncognitoWindow,
  setRestoreSession,
  setTree,
  setTreeId,
  setWindowType,
} from "./store";
import { toSelfHealingUpdate, toTabUpdate } from "./tab-update";
import { isTaborOwnTab, toActualTab } from "../shared/tabs";
import { queryOpenWindowIds } from "../shared/windows";

/**
 * Records a tab becoming active both in memory (for the rest of this
 * service worker’s lifetime) and in `chrome.storage.session` (for the next
 * one, see `active-tab-storage.ts`).
 */
function setAndPersistActiveTabId(windowId: number, tabId: number): void {
  setActiveTabId(windowId, tabId);
  void savePersistedActiveTabId(windowId, tabId);
}

/**
 * Records which tree a window holds both in memory and in
 * `chrome.storage.session` (for the next service worker lifetime, see
 * `reloadFromStorage`, and for the side panel to find its window’s tree).
 */
async function assignTreeId(windowId: number, treeId: string): Promise<void> {
  setTreeId(windowId, treeId);
  await saveTreeIdForWindow(windowId, treeId);
}

/**
 * Persists a window’s tree under the id of the tree it holds, assigning it a
 * fresh one first if it doesn’t hold one yet (e.g. an event for a brand-new
 * window arriving before `initializeWindow` has run for it).
 */
async function saveWindowTree(
  windowId: number,
  tree: TreeState,
): Promise<void> {
  let treeId = getTreeId(windowId);
  if (treeId === undefined) {
    treeId = createTreeId();
    await assignTreeId(windowId, treeId);
  }
  await saveTree(treeId, tree, {
    incognito: isIncognitoWindow(windowId),
    windowType: getWindowType(windowId),
  });
}

// TODO(debug): temporary instrumentation for two intermittent, hard-to-
// reproduce bugs (a stuck loading spinner on an already-loaded tab; a
// missing active-tab indicator after closing the active tab). Remove once
// root-caused. Prefixed and timestamped so its output can be correlated
// with the side panel’s own `[Tabor:sidepanel]` logs (a separate console).
const DEBUG_LOG_RETENTION_MS = 12 * 60 * 60 * 1000;

const debugLog = (() => {
  let counter = 0;

  return (
    event: string,
    data: Record<string, unknown>,
    { isIncognito = false }: { isIncognito?: boolean } = {},
  ): void => {
    // `JSON.stringify` here (rather than logging the object directly) so a
    // copy-paste of the console output carries the actual field values—an
    // inline console object otherwise collapses to a bare “Object” once
    // pasted as plain text outside DevTools.
    console.log(
      `[Tabor:background] ${event}`,
      JSON.stringify({ ...data, at: Date.now() }),
    );

    // Also persisted to `chrome.storage.local`, so it can be retrieved after
    // the fact even if nobody had the service worker’s inspector open while
    // it happened—attaching that inspector itself keeps the service worker
    // alive, which can mask a bug that only shows up when it’s genuinely
    // killed for going idle and restarted later. Each entry gets its own
    // unique key (timestamp + counter) rather than appending to one shared
    // array, so concurrent `debugLog` calls can’t race on a read-modify-write
    // and silently drop entries—the same kind of race `enqueue` had.
    // Pruned by `pruneOldDebugLogs` (see below) so these don’t accumulate
    // forever.
    //
    // Except for an event about an incognito window, which is only logged
    // to the console: nothing about one should be left on disk.
    if (isIncognito) {
      return;
    }
    const key = `${DEBUG_LOG_KEY_PREFIX}${Date.now()}-${counter}`;
    counter += 1;
    void chrome.storage.local.set({
      [key]: { event, ...data, at: Date.now() },
    });
  };
})();

// TODO(debug): removes `debugLog`’s persisted entries once they’re older
// than `DEBUG_LOG_RETENTION_MS`, so leaving this instrumentation running for
// an extended stretch (waiting on an intermittent bug to recur) doesn’t grow
// `chrome.storage.local` without bound. Half a day is plenty: whatever
// triggers a bug worth digging into is almost always something done not
// long before it’s noticed. Run from the periodic alarm (see
// `handlePeriodicAlarm`) instead of a dedicated one.
async function pruneOldDebugLogs(): Promise<void> {
  const keys = await chrome.storage.local.getKeys();
  const cutoff = Date.now() - DEBUG_LOG_RETENTION_MS;
  const staleKeys = keys.filter((key) => {
    if (!key.startsWith(DEBUG_LOG_KEY_PREFIX)) {
      return false;
    }
    const timestamp = Number(
      key.slice(DEBUG_LOG_KEY_PREFIX.length).split("-", 1)[0],
    );
    return !Number.isNaN(timestamp) && timestamp < cutoff;
  });
  if (staleKeys.length > 0) {
    await chrome.storage.local.remove(staleKeys);
  }
}

/**
 * Removes keys that sit under one of Tabor’s own prefixes but don’t fit its
 * shape (see `selectMalformedKeys`). Run from the periodic alarm (see
 * `handlePeriodicAlarm`).
 */
async function pruneMalformedKeys(): Promise<void> {
  const keys = await chrome.storage.local.getKeys();
  const malformedKeys = selectMalformedKeys(keys);
  if (malformedKeys.length > 0) {
    await chrome.storage.local.remove(malformedKeys);
  }
}

/**
 * Runs each queued task after the previous one settles, so that two events
 * arriving close together (e.g. both firing right as the service worker
 * wakes from being idle) can’t run their tree-store read/update/save cycles
 * concurrently and clobber each other’s result with a stale one.
 *
 * Deliberately NOT an `async` function: an `await settle(queue)` before
 * chaining onto `queue` would leave a window, between that `await` and the
 * following `queue = ...` reassignment, where a burst of calls arriving
 * synchronously (e.g. the dozens of tab events Chrome fires back-to-back
 * while tearing down a window with many tabs) all read the same
 * not-yet-updated `queue` and end up chained onto *that* instead of onto
 * each other—so their bodies run concurrently instead of in the intended
 * order, racing on the same window’s tree. Reassigning `queue` synchronously,
 * in the same tick as the call that reads it, closes that window: whichever
 * calls happen to arrive together are still chained one after another
 * because each sees the previous one’s reassignment before returning.
 */
const enqueue = (() => {
  let queue: Promise<void> = Promise.resolve();

  // Swallow a failure so it doesn’t block the tasks queued after it; the
  // caller of `enqueue` still sees the original error via the returned
  // promise below. `queue` itself must always be a promise that resolves
  // (never rejects)—otherwise a later `.then(task)` chained onto it would
  // skip that `task` entirely instead of still running it.
  // Deliberately plain `.catch()`/`.then()` below, not `await`: this must
  // reassign `queue` synchronously (see the comment above `enqueue`), and
  // `await` here would reintroduce exactly the race this function exists to
  // prevent.
  function settle(promise: Promise<void>): Promise<void> {
    // eslint-disable-next-line unicorn/prefer-await
    return promise.catch(() => {});
  }

  return (task: () => Promise<void>): Promise<void> => {
    // eslint-disable-next-line unicorn/prefer-await -- see `settle` above
    const result = queue.then(task);
    queue = settle(result);
    return result;
  };
})();

/**
 * Bounds how long `handleTabMoved` suppresses reconciling the tree from a
 * window’s native tab order, keyed by window id, after `syncNativeOrder`
 * moves tabs there itself.
 *
 * `chrome.tabs.move` given an array only actually dispatches its
 * `chrome.tabs.onMoved` events once every tab in it has finished moving—so
 * by the time any of them reach `handleTabMoved`, `chrome.tabs.query`
 * already reflects the final, fully-settled order for all of them, not a
 * gradually-changing one. That ruled out clearing this the moment one event
 * reports the target order having been reached: nearly every event in the
 * batch reports that same already-final order, so the first one to do so
 * would end the suppression while dozens more from the very same batch were
 * still on their way, each free to reconcile the tree via
 * `reorderFromNativeMove` against a move that isn’t a genuine user drag at
 * all—corrupting whatever tree `syncNativeOrder` was sent out to reflect in
 * the first place. A plain expiry, generous enough to outlast the whole
 * batch, avoids needing to identify the last event at all.
 */
const pendingNativeOrderSync = new Map<number, { expiresAt: number }>();
const NATIVE_ORDER_SYNC_GUARD_MS = 8000;

// Windows already reconciled this session, whether by `initializeAllWindows`
// or by `initializeWindow` itself. Chrome fires `windows.onCreated` not just
// for windows genuinely opened later, but also for ones session restore
// recreates at browser startup—so without this, a startup window would get
// redundantly (and, worse, incorrectly: see `initializeWindow` below)
// re-initialized right after `initializeAllWindows` already did it properly.
const initializedWindowIds = new Set<number>();

/**
 * Tracks how many `track()` calls currently think a restore is in progress
 * (a counter rather than a boolean, since more than one can be in flight at
 * once—e.g. the startup scan and a window opened moments later).
 * `handleTabCreated` checks `isRestoring()` before falling back to “parent =
 * whatever’s active” for a tab it can’t otherwise account for.
 *
 * `track()` keeps `isRestoring()` true until tab creation has gone fully
 * quiet (see `waitForTabCreationToFullySettle`), independently of—and
 * typically outlasting—the single settle round
 * `initializeAllWindows`/`initializeWindow` themselves wait for before
 * taking their own snapshot. A large session restore can burst, pause, and
 * burst again well past that first round, and while `handleTabCreated` has
 * no saved history to reconnect a straggler tab to (see `matchStraggler`),
 * the next best thing is to at least not mistake it for a genuinely new tab
 * and stack it under whatever’s active.
 */
const restoreTracking = (() => {
  let count = 0;

  return {
    isRestoring: (): boolean => count > 0,
    track: async (): Promise<void> => {
      count += 1;
      try {
        await waitForTabCreationToFullySettle();
      } finally {
        count -= 1;
      }
    },
  };
})();

const TAB_URL_RESOLVE_RETRY_MS = 200;
const TAB_URL_RESOLVE_MAX_ATTEMPTS = 5;

/**
 * `chrome.tabs.query` right after a large session restore can return tabs
 * whose `url`/`pendingUrl` are still both empty—Chrome creates the tab
 * objects (satisfying `waitForTabCreationToSettle`) before it’s finished
 * populating each one’s destination, especially when many of them are kept
 * discarded/unloaded rather than all loading at once. Matching a window
 * while any of its tabs are in that state makes every saved-tree candidate
 * score zero overlap, which `matchWindows` can’t tell apart from a
 * genuinely different set of tabs—so this retries the query a few times,
 * giving Chrome a moment to fill those in, rather than risk treating a
 * real match as none at all (and, following that, the saved tree being
 * deleted as stale).
 */
async function queryTabsWithResolvedUrls(
  windowId: number,
): Promise<chrome.tabs.Tab[]> {
  for (let attempt = 0; ; attempt++) {
    const tabs = await chrome.tabs.query({ windowId });
    const hasUnresolvedTab = tabs.some(
      (tab) => !isTaborOwnTab(tab) && !tab.url && !tab.pendingUrl,
    );
    if (!hasUnresolvedTab || attempt >= TAB_URL_RESOLVE_MAX_ATTEMPTS) {
      // TODO(debug): temporary instrumentation, see the block near the top
      // of this file—only logged when a retry actually happened or gave up
      // still unresolved, since the common case (nothing unresolved on the
      // first attempt) isn’t interesting.
      if (hasUnresolvedTab || attempt > 0) {
        debugLog(
          "queryTabsWithResolvedUrls",
          { windowId, attempt, hasUnresolvedTab, tabCount: tabs.length },
          { isIncognito: tabs.some((tab) => tab.incognito) },
        );
      }
      return tabs;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, TAB_URL_RESOLVE_RETRY_MS);
    });
  }
}

/**
 * Initialize a single new window, matching it by tab URL overlap (see
 * `matchWindows`) against every saved tree no other open window holds. A
 * window can show up already holding a previous session’s full set of tabs
 * (e.g. a profile switch recreating them for a browser process that was
 * already running, so `windows.onCreated` fires instead of
 * `runtime.onStartup`, or a closed window being reopened), and that saved
 * parent/child structure is only findable by content—nothing ties this
 * brand-new window to it yet. A match hands this window that tree’s id (see
 * `WINDOW_TREE_KEY_PREFIX`); otherwise it gets a fresh one.
 *
 * Waits for its own tab creation to settle first (see
 * `waitForTabCreationToSettle`) so a window opened with several tabs at once
 * (e.g. from a bookmark folder) doesn’t have the later ones missed by this
 * function’s own `tabs.query` and then mishandled as ordinary new tabs by
 * `handleTabCreated`. Queries via `queryTabsWithResolvedUrls`, the same as
 * `initializeAllWindows`, rather than a plain `chrome.tabs.query`: the
 * profile-switch case above recreates every tab at once, the same burst
 * `queryTabsWithResolvedUrls`’s own doc comment describes, so without this a
 * window’s tabs can still have empty `url`/`pendingUrl` here—scoring every
 * saved-tree candidate at zero overlap and silently discarding this window’s
 * real saved hierarchy for a fresh flat one built from its current tabs.
 *
 * Also simply never reruns for a window `initializeAllWindows` already
 * restored (see `initializedWindowIds` above). Chrome fires `windows.onCreated`
 * for a startup window too, not just ones genuinely opened later, and rerunning
 * this window’s own restore right after `initializeAllWindows` already did it
 * is at best wasted work reconciling the same tabs a second time.
 */
async function initializeWindow(
  windowId: number,
  isIncognito: boolean,
  windowType: WindowType,
): Promise<void> {
  if (initializedWindowIds.has(windowId)) {
    return;
  }
  initializedWindowIds.add(windowId);
  clearDeletedWindow(windowId);
  setIncognitoWindow(windowId, isIncognito);
  setWindowType(windowId, windowType);

  const settled = restoreTracking.track();
  await waitForTabCreationToSettle();
  const queriedTabs = await queryTabsWithResolvedUrls(windowId);
  const tabs = queriedTabs.filter((tab) => !isTaborOwnTab(tab));
  const actualTabs = tabs.map((tab) => toActualTab(tab));

  const savedTrees = await loadAllTrees();
  // Excludes trees another window already holds, so this window can’t steal
  // a match that rightfully belongs to one already up and running—but still
  // considers the tree this window itself already holds, if an earlier event
  // for it got it one (see `saveWindowTree`).
  const ownTreeId = getTreeId(windowId);
  const heldByOthers = new Set(
    getAllTreeIds()
      .entries()
      .filter(([heldWindowId]) => heldWindowId !== windowId)
      .map(([, treeId]) => treeId),
  );
  const savedWindows: SavedWindow[] = savedTrees
    .entries()
    .filter(([treeId]) => !heldByOthers.has(treeId))
    .map(([treeId, stored]) => ({
      id: treeId,
      tree: stored.tree,
      savedAt: stored.savedAt,
      incognito: stored.incognito,
    }))
    .toArray();

  const [match] = matchWindows(savedWindows, [
    { windowId, tabs: actualTabs, incognito: isIncognito },
  ]);
  const savedTree = match?.savedTree ?? { nodes: {}, rootIds: [] };

  const savedNodeCount = Object.keys(savedTree.nodes).length;
  debugLog(
    "initializeWindow",
    {
      windowId,
      matchedSavedTreeId: match?.savedId,
      savedNodeCount,
      candidateSavedTreeIds: savedWindows.map((saved) => saved.id),
      // TODO(debug): temporary instrumentation, see the block near the top of
      // this file—only logged when this window had tabs but matched no saved
      // tree, to see whether their `url`s were resolved by the time
      // `matchWindows` ran (a real page URL vs. an empty/placeholder one) for
      // a window that should have matched, and how close (if at all) it
      // actually came to matching each candidate saved window.
      ...(savedNodeCount === 0 &&
        actualTabs.length > 0 && {
          unmatchedTabCount: actualTabs.length,
          unmatchedUnresolvedUrlCount: actualTabs.filter((tab) => !tab.url)
            .length,
          unmatchedSampleUrls: actualTabs.slice(0, 5).map((tab) => tab.url),
          candidateScores: savedWindows.map((saved) => {
            const savedUrls = new Set(
              flattenDepthFirst(saved.tree).map((node) => node.url),
            );
            const actualUrls = new Set(actualTabs.map((tab) => tab.url));
            let overlap = 0;
            for (const url of savedUrls) {
              if (actualUrls.has(url)) {
                overlap += 1;
              }
            }
            return {
              savedTreeId: saved.id,
              savedNodeCount: savedUrls.size,
              overlap,
            };
          }),
        }),
    },
    { isIncognito },
  );
  const session = createRestoreSession(savedTree);
  const tree = restoreTree(savedTree, actualTabs, session);

  // Takes over the matched tree’s id, so it stays saved under the same key.
  const treeId = match?.savedId ?? ownTreeId ?? createTreeId();
  setTree(windowId, tree);
  setRestoreSession(windowId, session);
  await assignTreeId(windowId, treeId);
  await saveTree(treeId, tree, { incognito: isIncognito, windowType });
  await clearPendingRemoval(treeId);

  // A tree this window held before being matched to a different one (see
  // `ownTreeId`) is superseded by it, and no other window holds it.
  if (ownTreeId !== undefined && ownTreeId !== treeId) {
    await removeTree(ownTreeId);
  }

  const activeTab = tabs.find((tab) => tab.active);
  if (activeTab?.id !== undefined) {
    setAndPersistActiveTabId(windowId, activeTab.id);
  }

  // Once tab creation has gone fully quiet, this window’s restore session
  // has caught every straggler it’s going to—any tab created from here on
  // is a genuinely new one, not a late arrival from session restore. Drop
  // it so a tab opened much later can’t be mismatched against one of its
  // leftover saved nodes that was never consumed (see `removeRestoreSession`).
  void settled.then(() => removeRestoreSession(windowId));
}

// How long a saved tree may sit unmatched (see `markPendingRemoval`) before
// `initializeAllWindows` treats it as genuinely stale and deletes it. Long
// enough that a window the user only reopens occasionally—rather than every
// single browser restart—doesn’t lose its saved parent/child structure just
// because other windows (e.g. an installed PWA’s) happened to reopen ahead
// of it a couple of times first.
const PENDING_REMOVAL_GRACE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Initialize every window at browser startup, matching saved windows to
 * actual windows by tab URL overlap first (window ids don’t survive a
 * restart, so we can’t just look up each window’s tree by id).
 *
 * Waits for tab creation to settle first (see `waitForTabCreationToSettle`),
 * since Chrome’s own session restore recreates each previously open tab
 * asynchronously and querying tabs immediately on `runtime.onStartup` can
 * catch some windows before all of their tabs exist yet—but that wait has no
 * hard guarantee of catching every one of them (how long restore actually
 * takes isn’t something this can know in advance). So a `RestoreSession` is
 * also kept around per window afterward (see `getRestoreSession`): any saved
 * tab this pass didn’t find a match for is still there, ready for
 * `handleTabCreated` to match a straggler against once it actually shows up,
 * rather than that straggler falling through to being treated as an
 * ordinary brand-new tab (parented under whatever’s active) and losing its
 * real saved parent. And for a tab with no saved match at all—there’s
 * nothing unusual about a late-arriving tab having none, since plenty of
 * tabs are new every session—`restoreTracking` keeps `handleTabCreated` from
 * treating it as an ordinary new tab either, for as long as tab creation is
 * still ongoing.
 */
async function initializeAllWindows(excludeTabId?: number): Promise<void> {
  const settled = restoreTracking.track();
  await settled;
  debugLog("initializeAllWindows:settled", {});
  const windows = await chrome.windows.getAll();
  const windowIds = windows
    .map((window) => window.id)
    .filter((id): id is number => id !== undefined);
  const incognitoWindowIds = new Set(
    windows.filter((window) => window.incognito).map((window) => window.id),
  );
  const windowTypesById = new Map(
    windows.map((window) => [window.id, window.type ?? "normal"]),
  );

  const tabsByWindowId = new Map<number, chrome.tabs.Tab[]>();
  await Promise.all(
    windowIds.map(async (windowId) => {
      const queriedTabs = await queryTabsWithResolvedUrls(windowId);
      tabsByWindowId.set(
        windowId,
        // `excludeTabId` leaves out whichever tab’s own `onCreated` event is
        // driving this call (see `handleTabCreated`): when the service
        // worker had to wake up to deliver that very event, this query can
        // otherwise already see that brand-new tab too, folding it into this
        // startup-style reconciliation—as an unmatched, parentless root,
        // since a genuinely new tab has nothing to match in the saved
        // tree—instead of `handleTabCreated`’s own “parent = current tab”
        // handling for it right after this resolves.
        queriedTabs.filter(
          (tab) => !isTaborOwnTab(tab) && tab.id !== excludeTabId,
        ),
      );
    }),
  );

  const actualWindows: ActualWindow[] = windowIds.map((windowId) => ({
    windowId,
    tabs: (tabsByWindowId.get(windowId) ?? []).map((tab) => toActualTab(tab)),
    incognito: incognitoWindowIds.has(windowId),
  }));

  const savedTrees = await loadAllTrees();
  // A tree held by an open window this pass isn’t reconciling (e.g. one
  // `chrome.windows.getAll()`’s default window types leave out, during a
  // normal-windows gap) stays that window’s: neither offered to another
  // window as a match nor cleaned up below as unmatched.
  const reconciledWindowIds = new Set(windowIds);
  const heldElsewhere = new Set(
    getAllTreeIds()
      .entries()
      .filter(([windowId]) => !reconciledWindowIds.has(windowId))
      .map(([, treeId]) => treeId),
  );
  const savedWindows: SavedWindow[] = savedTrees
    .entries()
    .filter(([treeId]) => !heldElsewhere.has(treeId))
    .map(([treeId, stored]) => ({
      id: treeId,
      tree: stored.tree,
      savedAt: stored.savedAt,
      incognito: stored.incognito,
    }))
    .toArray();

  const matches = matchWindows(savedWindows, actualWindows);
  const matchByActualWindowId = new Map(
    matches.map((match) => [match.actualWindowId, match]),
  );
  const matchedTreeIds = new Set(
    matches.flatMap((match) =>
      match.savedId === undefined ? [] : match.savedId,
    ),
  );

  debugLog("initializeAllWindows", {
    actualWindowIds: windowIds,
    savedTreeIds: savedWindows.map((window) => window.id),
    matches: matches.map((match) => ({
      actualWindowId: match.actualWindowId,
      savedTreeId: match.savedId,
    })),
  });

  await Promise.all(
    actualWindows.map(async (actualWindow) => {
      const savedTree = matchByActualWindowId.get(actualWindow.windowId)
        ?.savedTree ?? { nodes: {}, rootIds: [] };
      const session = createRestoreSession(savedTree);
      const tree = restoreTree(savedTree, actualWindow.tabs, session);

      const savedNodeCount = Object.keys(savedTree.nodes).length;
      debugLog(
        "initializeAllWindows:restored",
        {
          actualWindowId: actualWindow.windowId,
          savedNodeCount,
          restoredNodeCount: Object.keys(tree.nodes).length,
          restoredChildIdCount: Object.values(tree.nodes).reduce(
            (total, node) => total + node.childIds.length,
            0,
          ),
          // TODO(debug): temporary instrumentation, see the block near the
          // top of this file—only logged for an actual window that had tabs
          // but matched no saved tree, to see whether their `url`s were
          // resolved by the time `matchWindows` ran (a real page URL vs. an
          // empty/placeholder one) for a window that should have matched, and
          // how close (if at all) it actually came to matching each candidate
          // saved window.
          ...(savedNodeCount === 0 &&
            actualWindow.tabs.length > 0 && {
              unmatchedTabCount: actualWindow.tabs.length,
              unmatchedUnresolvedUrlCount: actualWindow.tabs.filter(
                (tab) => !tab.url,
              ).length,
              unmatchedSampleUrls: actualWindow.tabs
                .slice(0, 5)
                .map((tab) => tab.url),
              candidateScores: savedWindows.map((saved) => {
                const savedUrls = new Set(
                  flattenDepthFirst(saved.tree).map((node) => node.url),
                );
                const actualUrls = new Set(
                  actualWindow.tabs.map((tab) => tab.url),
                );
                let overlap = 0;
                for (const url of savedUrls) {
                  if (actualUrls.has(url)) {
                    overlap += 1;
                  }
                }
                return {
                  savedTreeId: saved.id,
                  savedNodeCount: savedUrls.size,
                  overlap,
                };
              }),
            }),
        },
        { isIncognito: actualWindow.incognito },
      );

      // A matched window takes over its saved tree’s id, so the tree stays
      // saved under the same key. An unmatched one keeps the tree id it
      // already holds (e.g. during a normal-windows gap), unless another
      // window was just matched to that tree, and otherwise gets a fresh one.
      const heldTreeId = getTreeId(actualWindow.windowId);
      const treeId =
        matchByActualWindowId.get(actualWindow.windowId)?.savedId ??
        (heldTreeId === undefined || matchedTreeIds.has(heldTreeId)
          ? createTreeId()
          : heldTreeId);

      const isIncognito = incognitoWindowIds.has(actualWindow.windowId);
      const windowType = windowTypesById.get(actualWindow.windowId) ?? "normal";
      setTree(actualWindow.windowId, tree);
      setIncognitoWindow(actualWindow.windowId, isIncognito);
      setWindowType(actualWindow.windowId, windowType);
      setRestoreSession(actualWindow.windowId, session);
      await assignTreeId(actualWindow.windowId, treeId);
      await saveTree(treeId, tree, { incognito: isIncognito, windowType });
      initializedWindowIds.add(actualWindow.windowId);
      clearDeletedWindow(actualWindow.windowId);

      const tabs = tabsByWindowId.get(actualWindow.windowId) ?? [];
      const activeTab = tabs.find((tab) => tab.active);
      if (activeTab?.id !== undefined) {
        setAndPersistActiveTabId(actualWindow.windowId, activeTab.id);
      }
    }),
  );

  // See the matching comment in `initializeWindow`: once settled, none of
  // these sessions can still be useful for catching a genuine straggler.
  void settled.then(() => {
    for (const actualWindow of actualWindows) {
      removeRestoreSession(actualWindow.windowId);
    }
    return;
  });

  // A saved tree no window took over just now is a removal *candidate*—but,
  // unless it holds nothing worth losing (see `hasTaborSpecificInfo`), not
  // deleted outright (see `markPendingRemoval`): a window whose session
  // restore hadn’t finished recreating it in time for this pass’s own
  // snapshot (e.g. because another window, like a lightweight installed-PWA
  // window, was recreated first—possibly repeatedly across several browser
  // restarts before the real window ever reopens) would otherwise have its
  // real saved tree deleted as stale before it ever got a chance to be
  // matched. Only deleted once its mark is older than
  // `PENDING_REMOVAL_GRACE_MS`, not merely on the next miss—an installed-PWA
  // window reopening on every restart ahead of a real window the user only
  // opens occasionally would otherwise still rack up two straight misses
  // for it in no time at all. A flat tree with no notes has nothing to lose
  // that way—reopening those same tabs later would rebuild an identical tree
  // regardless of whether this saved one still exists—so it’s simply
  // deleted right away instead of accumulating pending-removal clutter for
  // windows that keep never quite matching (e.g. a one-off popup or
  // print-preview window whose exact tab set never recurs).
  //
  // An incognito window’s saved tree is deleted right away too, whatever it
  // holds: it’s only still around because its window closed without
  // `windows.onRemoved` getting to remove it (e.g. a crash), and incognito
  // windows are never restored, so there’s nothing to wait for. The same
  // goes for a non-normal window’s (see `windows.onRemoved` below).
  //
  // A saved tree a window did take over may still carry a stale
  // pending-removal mark from an earlier pass that missed it (e.g. a
  // transient unresolved-tab-URL race in `queryTabsWithResolvedUrls`).
  // Clear that mark rather than leaving it—otherwise a later, genuine miss
  // would inherit that stale timestamp instead of starting its own grace
  // period fresh, risking premature deletion.
  const assignedTreeIds = new Set(
    actualWindows.flatMap((actualWindow) => {
      const treeId = getTreeId(actualWindow.windowId);
      return treeId === undefined ? [] : treeId;
    }),
  );
  const unmatchedSavedWindows = savedWindows.filter(
    (saved) => !assignedTreeIds.has(saved.id),
  );
  const previouslyPendingRemoval = await loadPendingRemovals();

  await Promise.all([
    // TODO(debug): temporary instrumentation, see the block near the top of
    // this file—records exactly what this pass saw for each unmatched saved
    // window at the moment it decided whether to keep, mark, or delete it,
    // to catch a case where `saved.tree` (from this call’s own `loadAllTrees`
    // snapshot) unexpectedly disagrees with what a backup taken moments
    // earlier (via the in-memory `getAllTrees`) showed for the same window.
    ...unmatchedSavedWindows.map((saved) => {
      const isWorthKeeping = hasTaborSpecificInfo(saved.tree);
      const isIncognito = saved.incognito ?? false;
      const windowType = savedTrees.get(saved.id)?.windowType ?? "normal";
      const markedAt = previouslyPendingRemoval.get(saved.id);
      const isExpired =
        markedAt !== undefined &&
        Date.now() - markedAt >= PENDING_REMOVAL_GRACE_MS;
      debugLog(
        "initializeAllWindows:staleCleanup",
        {
          treeId: saved.id,
          savedAt: saved.savedAt,
          nodeCount: Object.keys(saved.tree.nodes).length,
          rootCount: saved.tree.rootIds.length,
          isWorthKeeping,
          isIncognito,
          windowType,
          markedAt,
          action:
            isWorthKeeping && !isIncognito && windowType === "normal"
              ? isExpired
                ? "removeExpired"
                : "markPending"
              : "removeImmediately",
        },
        { isIncognito },
      );

      if (
        !isWorthKeeping ||
        isIncognito ||
        windowType !== "normal" ||
        isExpired
      ) {
        return removeTree(saved.id);
      }
      return markPendingRemoval(saved.id);
    }),
    ...assignedTreeIds.values().map((treeId) => clearPendingRemoval(treeId)),
  ]);
}

// Whether the one genuine, URL-matching startup reconciliation
// (`initializeAllWindows`) has already happened this browser session.
// `chrome.storage.session` is the right place to track it: unlike
// `chrome.storage.local`, it’s cleared when the browser itself restarts,
// but—unlike an in-memory flag here—it survives the service worker being
// killed and restarted for merely going idle, which happens constantly
// during ordinary use and isn’t a real restart at all.
async function hasReconciledThisBrowserSession(): Promise<boolean> {
  const result = await chrome.storage.session.get(SESSION_RECONCILED_KEY);
  return result[SESSION_RECONCILED_KEY] === true;
}

async function markReconciledThisBrowserSession(): Promise<void> {
  await chrome.storage.session.set({ [SESSION_RECONCILED_KEY]: true });
}

/**
 * Hydrates the in-memory store from `chrome.storage.local` as-is, without
 * the URL-based reconciliation `initializeAllWindows` does. Used once this
 * browser session’s one genuine startup reconciliation has already
 * happened (see `hasReconciledThisBrowserSession`): the service worker
 * going idle and being killed, then waking back up for the next event,
 * doesn’t change any window’s or tab’s identity the way an actual browser
 * restart does, so there’s no need to re-match anything by URL—the
 * persisted trees are already accurate as of the last save, and just need
 * to be read back into memory.
 *
 * Doing this instead of `initializeAllWindows` also sidesteps
 * `restoreTracking`: that call would otherwise mark tab creation as
 * “restoring” for a good several hundred milliseconds after every single
 * idle wake-up—including the wake-up caused by an entirely ordinary new
 * tab’s own `onCreated` event—which left `handleTabCreated` unable to tell
 * that case apart from a genuine session-restore burst, and made it treat
 * that one ordinary tab as parentless instead of a child of the current
 * tab.
 *
 * Restores the tree of every window recorded as holding one (see
 * `TREE_ID_KEY_PREFIX`)—deliberately *not* filtered against a live
 * `chrome.windows.getAll()` query, despite that seeming like the more
 * obviously “correct” set of windows to restore. A window mid-close (its
 * tabs’ own `onRemoved`/`onUpdated` events still working through `enqueue`,
 * `windows.onRemoved` itself not yet reached) has already dropped out of
 * `chrome.windows.getAll()`’s results even though this window id hasn’t
 * been confirmed closed in *this* event stream yet. Filtering it out here
 * left this window absent from the in-memory store; the very next handler
 * for one of its still-in-flight events (e.g. `handleTabUpdated`) would
 * then see `getTree` fall back to an empty tree, and—having no reason to
 * suspect otherwise—save that empty tree right over its real, still-valid
 * one moments before `windows.onRemoved` finally arrived to clean it up
 * properly. A window’s tree-id record doesn’t have this race: it’s only
 * removed once `windows.onRemoved` has actually been processed for it, in
 * the same serialized `enqueue` order every other handler observes—so a
 * window mid-close is (correctly) still restored here, and whichever
 * handler is already queued to finish tearing it down does so against its
 * real data, not a blank one this function manufactured. Closed windows’
 * saved trees, on the other hand, have no such record, so they stay out of
 * the store (and out of `initializedWindowIds`).
 */
async function reloadFromStorage(): Promise<void> {
  const [savedTrees, treeIdsByWindowId] = await Promise.all([
    loadAllTrees(),
    loadTreeIdsByWindowId(),
  ]);

  await Promise.all(
    treeIdsByWindowId
      .entries()
      .filter(([windowId]) => !isDeletedWindow(windowId))
      .map(async ([windowId, treeId]) => {
        setTreeId(windowId, treeId);
        const stored = savedTrees.get(treeId);
        if (stored !== undefined) {
          setTree(windowId, stored.tree);
          setIncognitoWindow(windowId, stored.incognito === true);
          setWindowType(windowId, stored.windowType ?? "normal");
        }
        initializedWindowIds.add(windowId);

        // The *persisted* active tab id, not a fresh `chrome.tabs.query`:
        // whichever event just woke the service worker up may itself have
        // already changed which tab is live-active (e.g. a new foreground
        // tab is active from the moment it’s created), which would make a
        // live query racy—see `active-tab-storage.ts`.
        const persistedActiveTabId = await loadPersistedActiveTabId(windowId);
        if (persistedActiveTabId !== undefined) {
          setActiveTabId(windowId, persistedActiveTabId);
          return;
        }

        const [activeTab] = await chrome.tabs.query({
          active: true,
          windowId,
        });
        if (activeTab?.id !== undefined) {
          setAndPersistActiveTabId(windowId, activeTab.id);
        }
      }),
  );
}

/**
 * The MV3 service worker can be killed and restarted at any time (e.g.
 * after being idle), which wipes the in-memory store from `./store`. Each
 * event handler calls this first so that, whichever event happens to wake
 * the service worker up, the store gets reloaded from `chrome.storage`
 * before that event is handled—otherwise it would build on an empty tree
 * and overwrite the saved one.
 */
const ensureInitialized = (() => {
  let initializationPromise: Promise<void> | undefined;
  // `excludeTabId` only actually applies the first time this initializes
  // (whichever call first sets `initializationPromise`), and only when that
  // call ends up running the full `initializeAllWindows` reconciliation
  // (see `reloadFromStorage` for why the other path doesn’t need it at
  // all). A later, already-in-flight or already-resolved call just awaits
  // the same promise as before.
  return async (excludeTabId?: number): Promise<void> => {
    initializationPromise ??= (async () => {
      // Before either path below reads any saved tree, so both only ever see
      // the current key scheme.
      await migrateLegacyTrees(await queryOpenWindowIds());
      const isReconciled = await hasReconciledThisBrowserSession();
      debugLog("ensureInitialized", { isReconciled, excludeTabId });
      if (isReconciled) {
        await reloadFromStorage();
      } else {
        await initializeAllWindows(excludeTabId);
        await markReconciledThisBrowserSession();
      }
    })();
    try {
      await initializationPromise;
    } catch (error) {
      // Let the next call retry instead of caching a permanent failure.
      initializationPromise = undefined;
      console.error("Tabor: failed to initialize", error);
      throw error;
    }
  };
})();

// Whether the profile’s normal windows (not counting e.g. an installed PWA’s
// own app-type window in the same profile) have dropped to zero since the
// last time one was open. Set by `chrome.windows.onRemoved` below and
// consumed by `chrome.windows.onCreated`: closing every normal window
// doesn’t necessarily end the browser process—an installed PWA sharing the
// profile, or simply not quitting the browser app on macOS after its last
// window closes, both keep it running—so the saved trees for those closed
// windows are still sitting in `chrome.storage.local` under now-gone window
// ids when the next one opens, exactly as they would be at a real
// `runtime.onStartup`.
//
// Backed by `chrome.storage.session`, not a plain in-memory variable: the
// service worker can be killed for going idle (routinely, after ~30
// seconds) at any point between the last normal window closing and the next
// one opening, which would silently wipe an in-memory flag before it ever
// got consumed—see `hasReconciledThisBrowserSession` above for the same
// reasoning.
//
// Deliberately kept independent of `hasReconciledThisBrowserSession`’s own
// flag, rather than reusing or clearing it directly: any other event
// arriving in the meantime (e.g. the PWA’s own tab updating its title or
// favicon) also calls `ensureInitialized`, and if that flag were cleared
// here instead, such an unrelated event could run `initializeAllWindows`
// first—matching only that PWA window against every saved tree and then, in
// its own stale-window cleanup, permanently deleting every real window’s
// saved tree before the user gets a chance to reopen it.
async function isNormalWindowsGapPending(): Promise<boolean> {
  const result = await chrome.storage.session.get(NORMAL_WINDOWS_GAP_KEY);
  return result[NORMAL_WINDOWS_GAP_KEY] === true;
}

async function markNormalWindowsGapPending(): Promise<void> {
  await chrome.storage.session.set({ [NORMAL_WINDOWS_GAP_KEY]: true });
}

async function clearNormalWindowsGapPending(): Promise<void> {
  await chrome.storage.session.remove(NORMAL_WINDOWS_GAP_KEY);
}

async function handleTabCreated(tab: chrome.tabs.Tab): Promise<void> {
  await ensureInitialized(tab.id);

  if (
    tab.id === undefined ||
    isTaborOwnTab(tab) ||
    isDeletedWindow(tab.windowId)
  ) {
    return;
  }

  const tree = getTree(tab.windowId);
  // Already tracked, most likely because this tab’s own `onCreated` fired
  // during startup’s tab-creation settle wait (see
  // `waitForTabCreationToSettle`) and it was therefore already picked up by
  // `initializeAllWindows`/`initializeWindow`’s own tab query. Adding it
  // again here would duplicate it under a brand-new node, parented under
  // whatever’s active rather than wherever the tree just restored it to.
  if (tree.nodes[tab.id] !== undefined) {
    return;
  }

  // Vivaldi fires `onCreated` for another extension’s side panel document
  // (e.g. Bitwarden’s `sidepanel-disabled.html`) as if it were a tab, but
  // leaves it out of `chrome.tabs.query`—it isn’t part of the tab strip, so
  // clicking its row in the tree would do nothing. A real tab is already in
  // its window’s tab strip by the time its `onCreated` arrives.
  const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
  if (windowTabs.every((windowTab) => windowTab.id !== tab.id)) {
    return;
  }

  const actualTab = toActualTab(tab);
  const session = getRestoreSession(tab.windowId);
  const straggler = session && matchStraggler(session, actualTab);

  if (straggler || restoreTracking.isRestoring()) {
    // Either a tab from startup’s own session restore that this window’s
    // initial restore pass (see `getRestoreSession`) didn’t get to see yet,
    // reconnected here to its real saved parent—or, if no saved match was
    // found, one Chrome is still busy creating as part of that same restore
    // (see `restoreTracking`), where falling through to “parent =
    // whatever’s active” below risks stacking a pile of unrelated restored
    // tabs under it.
    const parentId = straggler ? straggler.parentId : null;
    let updated = addTab(tree, actualTab, parentId);

    if (!straggler && !actualTab.pinned) {
      // A genuinely new tab with no saved match (e.g. a browser-injected
      // page like Chrome’s “What’s New” tab after an update) still has a
      // real native position among the tabs restored so far. `addTab` just
      // appends it as the last root, which is wrong whenever it actually
      // sits in the middle of the tab strip. Reuse `reorderFromNativeMove`’s
      // placement logic to correct that purely in the tree data—this
      // deliberately doesn’t call `syncNativeOrder` (see below), since the
      // window may still be mid-restore and this shouldn’t reshuffle it.
      const nativeTabs = await chrome.tabs.query({
        windowId: tab.windowId,
        pinned: false,
      });
      const newOrder = nativeTabs
        .map((nativeTab) => nativeTab.id)
        .filter((id): id is number => id !== undefined);
      updated = reorderFromNativeMove(updated, actualTab.id, newOrder);
    }

    setTree(tab.windowId, updated);
    await saveWindowTree(tab.windowId, updated);
    return;
  }

  const parentId = getActiveTabId(tab.windowId) ?? null;
  const updated = addTab(tree, actualTab, parentId);
  setTree(tab.windowId, updated);
  await saveWindowTree(tab.windowId, updated);

  // `addTab` places the tab in the tree (e.g. as its parent’s last child),
  // but Chrome creates it wherever it likes natively—often the far end of
  // the tab strip for a blank tab (Ctrl+T), not next to its parent. Without
  // this, the tree and the native tab bar would disagree about this tab’s
  // position until some unrelated move reconciled them, which broke
  // Ctrl+Tab and similar native, position-based navigation.
  await syncNativeOrder(updated, tab.windowId);
}

async function handleTabRemoved(
  tabId: number,
  info: chrome.tabs.OnRemovedInfo,
): Promise<void> {
  await ensureInitialized();
  debugLog(
    "onRemoved",
    {
      tabId,
      windowId: info.windowId,
      isWindowClosing: info.isWindowClosing,
    },
    { isIncognito: isIncognitoWindow(info.windowId) },
  );

  // The window itself is being torn down; `windows.onRemoved` will drop its
  // tree, so there’s no need to reconcile it tab by tab here.
  if (info.isWindowClosing || isDeletedWindow(info.windowId)) {
    return;
  }

  noteTabRemoved(info.windowId, tabId);

  const tree = getTree(info.windowId);
  const updated = removeTab(tree, tabId);
  setTree(info.windowId, updated);
  await saveWindowTree(info.windowId, updated);

  settlePendingClose(info.windowId);
}

async function handleTabMoved(
  tabId: number,
  info: chrome.tabs.OnMovedInfo,
): Promise<void> {
  await ensureInitialized();

  const nativeTabs = await chrome.tabs.query({
    windowId: info.windowId,
    pinned: false,
  });
  const newOrder = nativeTabs
    .map((tab) => tab.id)
    .filter((id): id is number => id !== undefined);

  const pending = pendingNativeOrderSync.get(info.windowId);
  const isSuppressed = pending !== undefined && Date.now() < pending.expiresAt;
  if (isSuppressed || isDeletedWindow(info.windowId)) {
    return;
  }

  const tree = getTree(info.windowId);
  const updated = reorderFromNativeMove(tree, tabId, newOrder);
  setTree(info.windowId, updated);
  await saveWindowTree(info.windowId, updated);
}

async function handleTabAttached(
  tabId: number,
  info: chrome.tabs.OnAttachedInfo,
): Promise<void> {
  await ensureInitialized();

  if (isDeletedWindow(info.newWindowId)) {
    return;
  }

  const tab = await chrome.tabs.get(tabId);
  const tree = getTree(info.newWindowId);
  const updated = addTab(tree, toActualTab(tab), null);
  setTree(info.newWindowId, updated);
  await saveWindowTree(info.newWindowId, updated);

  // Part of a “move tab(s)/tree(s) to window” batch (see
  // `pending-tree-move.ts`)—once every tab in it has landed here as a root,
  // reconstruct their original relative parent/child structure instead of
  // leaving them all flattened.
  const reparented = noteTreeMoveAttached(tabId, info.newWindowId);
  if (reparented === undefined) {
    return;
  }

  setTree(info.newWindowId, reparented);
  await saveWindowTree(info.newWindowId, reparented);
  await syncNativeOrder(reparented, info.newWindowId);
}

async function handleTabDetached(
  tabId: number,
  info: chrome.tabs.OnDetachedInfo,
): Promise<void> {
  await ensureInitialized();

  if (isDeletedWindow(info.oldWindowId)) {
    return;
  }

  // As far as the old window is concerned, a tab moving out is the same as
  // it closing—so pick the next active tab the same way, rather than
  // leaving it to Chrome’s own (native-order-based) pick.
  noteTabRemoved(info.oldWindowId, tabId);

  const tree = getTree(info.oldWindowId);
  const updated = removeTab(tree, tabId);
  setTree(info.oldWindowId, updated);
  await saveWindowTree(info.oldWindowId, updated);

  settlePendingClose(info.oldWindowId);
}

/**
 * Chrome fires this instead of a remove/create pair when it swaps a tab’s
 * underlying process for a new one with a new id—notably, when a discarded
 * tab is reloaded (also for prerendering/instant navigation). Rename the id
 * in place so the tab keeps its position, parent, and children.
 */
async function handleTabReplaced(
  addedTabId: number,
  removedTabId: number,
): Promise<void> {
  await ensureInitialized();

  const tab = await chrome.tabs.get(addedTabId);
  if (isDeletedWindow(tab.windowId)) {
    return;
  }

  const actualTab = toActualTab(tab);
  const tree = getTree(tab.windowId);
  const updated = replaceTabId(tree, removedTabId, addedTabId, {
    url: actualTab.url,
    title: actualTab.title,
    favIconUrl: actualTab.favIconUrl,
    loading: actualTab.loading,
    suspended: actualTab.suspended,
  });
  setTree(tab.windowId, updated);
  await saveWindowTree(tab.windowId, updated);

  if (getActiveTabId(tab.windowId) === removedTabId) {
    setAndPersistActiveTabId(tab.windowId, addedTabId);
  }
}

async function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
): Promise<void> {
  await ensureInitialized();
  debugLog(
    "onUpdated",
    {
      tabId,
      changeInfo,
      status: tab.status,
      discarded: tab.discarded,
    },
    { isIncognito: tab.incognito },
  );

  if (isDeletedWindow(tab.windowId)) {
    return;
  }

  const update = toTabUpdate(changeInfo, tab);
  const tree = getTree(tab.windowId);
  let updated = updateTab(tree, tabId, update);

  if (update.pinned === true) {
    const nativePinnedTabs = await chrome.tabs.query({
      windowId: tab.windowId,
      pinned: true,
    });
    const nativePinnedOrder = nativePinnedTabs
      .map((nativeTab) => nativeTab.id)
      .filter((id): id is number => id !== undefined);
    updated = reorderFromPinnedChange(updated, tabId, nativePinnedOrder);
  }

  // Most `onUpdated` events carry nothing new for the tree (see `updateTab`).
  if (updated === tree) {
    return;
  }

  setTree(tab.windowId, updated);
  await saveWindowTree(tab.windowId, updated);
}

/**
 * Besides tracking the active tab, re-reads the activated tab’s actual
 * loading/discarded state and corrects the tree if it’s out of sync—the
 * same self-healing `toSelfHealingUpdate` applies to an `onUpdated` event
 * with nothing more specific to go on, but triggered by the tab becoming
 * active rather than waiting for its next `onUpdated` event, so a tab stuck
 * showing a stale spinner fixes itself as soon as it’s clicked.
 */
async function handleTabActivated(
  activeInfo: chrome.tabs.OnActivatedInfo,
): Promise<void> {
  await ensureInitialized();

  if (isDeletedWindow(activeInfo.windowId)) {
    return;
  }

  setAndPersistActiveTabId(activeInfo.windowId, activeInfo.tabId);

  const tab = await chrome.tabs.get(activeInfo.tabId);
  debugLog(
    "onActivated",
    {
      tabId: activeInfo.tabId,
      windowId: activeInfo.windowId,
      status: tab.status,
      discarded: tab.discarded,
    },
    { isIncognito: tab.incognito },
  );

  const tree = getTree(activeInfo.windowId);
  const updated = updateTab(tree, activeInfo.tabId, toSelfHealingUpdate(tab));
  // The activated tab’s state is usually already in sync (see `updateTab`).
  if (updated === tree) {
    return;
  }

  setTree(activeInfo.windowId, updated);
  await saveWindowTree(activeInfo.windowId, updated);
}

async function handleToggleCollapsed(tabId: number): Promise<void> {
  await ensureInitialized();

  const tab = await chrome.tabs.get(tabId);
  const tree = getTree(tab.windowId);
  const node = tree.nodes[tabId];
  if (node === undefined) {
    return;
  }

  const updated = updateTab(tree, tabId, { collapsed: !node.collapsed });
  setTree(tab.windowId, updated);
  await saveWindowTree(tab.windowId, updated);
}

async function handleUpdateNote(
  tabId: number,
  note: string | null,
): Promise<void> {
  await ensureInitialized();

  const tab = await chrome.tabs.get(tabId);
  const tree = getTree(tab.windowId);
  const node = tree.nodes[tabId];
  if (node === undefined) {
    return;
  }

  const updated = updateTab(tree, tabId, { note });
  setTree(tab.windowId, updated);
  await saveWindowTree(tab.windowId, updated);
}

/**
 * Move the window’s tabs to match the tree’s order: pinned tabs to
 * `getPinnedNodes`’ order, at the window’s frontmost slots, followed by the
 * non-pinned tabs to the tree’s depth-first order. Used after a side-panel
 * drag-and-drop changes the tree, since that only updates our own state—
 * chrome.tabs.onMoved tells us about the opposite direction (native move ->
 * tree update), not this one.
 *
 * The non-pinned tabs’ target index is offset by how many pinned tabs there
 * are, since pinned tabs always occupy the window’s frontmost slots—rather
 * than assuming Chrome slots a non-pinned tab in after them on its own
 * regardless of the index we ask for.
 */
async function syncNativeOrder(
  tree: TreeState,
  windowId: number,
): Promise<void> {
  const pinnedOrder = getPinnedNodes(tree).map((node) => node.id);
  const order = getNativeOrder(tree).filter(
    (id) => tree.nodes[id]?.pinned !== true,
  );
  if (pinnedOrder.length === 0 && order.length === 0) {
    return;
  }

  pendingNativeOrderSync.set(windowId, {
    expiresAt: Date.now() + NATIVE_ORDER_SYNC_GUARD_MS,
  });
  // Moved one at a time, not as a single `chrome.tabs.move(order, ...)`
  // batch: given an array of ids, Chrome (like Firefox—see
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1323311) moves each one to
  // `index`, `index + 1`, etc. in array order without accounting for how far
  // its *own* current position already is from that target, so an id whose
  // native position is far from where the rest of the array already sits
  // (e.g. a brand new tab Chrome created at the far end of the tab strip)
  // can land scattered away from its intended neighbors instead of next to
  // them. Moving a single id at a time has no such array-relative ambiguity:
  // each call unambiguously means “put this one tab at this index”.
  for (const [index, id] of pinnedOrder.entries()) {
    try {
      await chrome.tabs.move(id, { windowId, index });
    } catch (error) {
      // The id no longer resolving to a real tab (e.g. the tree holding a
      // stale id for a tab that’s since closed or moved to another window)
      // shouldn’t stop the rest of `pinnedOrder`/`order` from reaching their
      // own target index, which a thrown error here would otherwise skip
      // entirely.
      console.error("Tabor: failed to move a pinned tab", {
        windowId,
        id,
        index,
        error,
      });
    }
  }
  for (const [offset, id] of order.entries()) {
    const index = pinnedOrder.length + offset;
    try {
      await chrome.tabs.move(id, { windowId, index });
    } catch (error) {
      console.error("Tabor: failed to move a tab", {
        windowId,
        id,
        index,
        error,
      });
    }
  }
}

/**
 * Reconciles a chosen backup’s tree for one window with that window’s tabs
 * as they actually stand right now, the same way a saved tree is reconciled
 * with actual tabs at startup (see `restoreTree`)—so a tab opened/closed
 * since the backup was taken doesn’t cause a mismatch, and pinned/suspended
 * state stays whatever it actually is now rather than reverting to the
 * backup’s.
 *
 * The backup’s own window ids can’t be looked up directly against the
 * current window: like tab ids, they don’t survive a browser restart. Used
 * the same URL-overlap matching (`matchWindows`) startup restore already
 * relies on for the same reason, rather than assuming the backup’s
 * `windows[windowId]` entry is the right one.
 */
async function handleRestoreBackup(
  windowId: number,
  timestamp: number,
): Promise<void> {
  await ensureInitialized();

  if (isDeletedWindow(windowId)) {
    return;
  }

  const backup = await loadBackup(timestamp);
  const savedWindows: SavedWindow[] = Object.entries(backup ?? {}).map(
    ([savedWindowId, tree]) => ({
      id: savedWindowId,
      tree,
      // The whole snapshot was saved at once, so every window in it shares
      // this same `savedAt`—see `matchWindows`’s use of it.
      savedAt: timestamp,
    }),
  );

  const queriedTabs = await chrome.tabs.query({ windowId });
  const actualTabs = queriedTabs
    .filter((tab) => !isTaborOwnTab(tab))
    .map((tab) => toActualTab(tab));

  const [match] = matchWindows(savedWindows, [{ windowId, tabs: actualTabs }]);
  const savedTree = match?.savedTree ?? { nodes: {}, rootIds: [] };

  const restored = restoreTree(savedTree, actualTabs);
  setTree(windowId, restored);
  await saveWindowTree(windowId, restored);
  await syncNativeOrder(restored, windowId);
}

/**
 * Removes the saved trees the user picked out as belonging to windows that
 * are no longer open (see `RemoveSavedTreesMessage`). Re-checks against the
 * trees open windows hold right now rather than trusting the side panel’s
 * list, which may be stale by the time this runs, so a live window’s tree is
 * never removed.
 */
async function handleRemoveSavedTrees(treeIds: string[]): Promise<void> {
  await ensureInitialized();

  const openWindowIds = new Set(await queryOpenWindowIds());
  const heldTreeIds = getAllTreeIds()
    .entries()
    .filter(([windowId]) => openWindowIds.has(windowId))
    .map(([, treeId]) => treeId);
  const removable = new Set(selectOrphanedTreeIds(treeIds, heldTreeIds));

  // A window mid-close (its `windows.onRemoved` not handled yet) may still
  // hold one of these in the store; drop it the same way that handler will,
  // so none of its in-flight events saves the removed tree right back.
  for (const [windowId, treeId] of getAllTreeIds()) {
    if (!removable.has(treeId)) {
      continue;
    }
    deleteWindow(windowId);
    initializedWindowIds.delete(windowId);
    await removeTreeIdForWindow(windowId);
  }

  await Promise.all(removable.values().map((treeId) => removeTree(treeId)));
}

async function handleMoveNode(
  tabIds: number[],
  target: DropTarget,
): Promise<void> {
  await ensureInitialized();

  const [firstTabId] = tabIds;
  if (firstTabId === undefined) {
    return;
  }

  // All dragged tabs come from the same side panel, so they’re always in
  // the same window; look it up via any one of them.
  const tab = await chrome.tabs.get(firstTabId);
  if (isDeletedWindow(tab.windowId)) {
    return;
  }

  const tree = getTree(tab.windowId);
  const updated = moveNodes(tree, tabIds, target);
  if (updated === tree) {
    return;
  }

  setTree(tab.windowId, updated);
  await saveWindowTree(tab.windowId, updated);
  await syncNativeOrder(updated, tab.windowId);
}

const PERIODIC_ALARM_NAME = "tabor-periodic";
// The alarm’s name before it started running more than just backups. Alarms
// persist in Chrome across service worker restarts and extension updates
// (see `ensurePeriodicAlarm`), so one created under this name keeps firing
// until explicitly cleared.
const LEGACY_BACKUP_ALARM_NAME = "tabor-backup-snapshot";
// The periodic alarm’s interval, set by what backups need: it matches the
// first backup-thinning bucket edge (see `selectBackupTimestampsToKeep`).
const BACKUP_INTERVAL_MINUTES = 5;

/**
 * Snapshots every open window’s tree for on-demand restore later, then thins
 * out older snapshots (see `selectBackupTimestampsToKeep`) so the backup
 * history doesn’t grow without bound.
 *
 * Only open windows’ trees: after an idle-wake restart, this store also
 * holds the saved trees of windows closed long ago (see
 * `reloadFromStorage`). Left in, they’d make a snapshot’s contents depend on
 * whether the service worker happened to restart since startup, and give
 * `matchWindows` a closed window’s tree to pick over the current window’s
 * own when restoring.
 *
 * Skipped while every normal window is momentarily gone (see
 * `isNormalWindowsGapPending`—e.g. between closing the last one and a
 * profile switch reopening it): the open windows at that instant would be
 * only whatever lightweight windows (installed PWAs, etc.) happen to still
 * be open, silently dropping the real window’s tree from this snapshot
 * instead of the alarm simply catching it on its next tick.
 */
async function takeBackupSnapshot(): Promise<void> {
  if (await isNormalWindowsGapPending()) {
    return;
  }

  const openWindowIds = new Set(await queryOpenWindowIds());
  // An incognito window’s tree is left out: it’s removed once its window
  // closes, and a backup shouldn’t keep it around past that.
  const windows = Object.fromEntries(
    Object.entries(getAllTrees()).filter(
      ([windowId]) =>
        openWindowIds.has(Number(windowId)) &&
        !isIncognitoWindow(Number(windowId)),
    ),
  );
  if (Object.keys(windows).length === 0) {
    return;
  }

  await saveBackup(Date.now(), windows);

  const timestamps = await loadBackupTimestamps();
  const kept = new Set(selectBackupTimestampsToKeep(timestamps, Date.now()));
  const toRemove = timestamps.filter((timestamp) => !kept.has(timestamp));
  if (toRemove.length > 0) {
    await removeBackups(toRemove);
  }
}

/**
 * Periodic housekeeping, run on every `PERIODIC_ALARM_NAME` tick.
 */
async function handlePeriodicAlarm(): Promise<void> {
  await ensureInitialized();
  await pruneOldDebugLogs();
  await pruneMalformedKeys();
  await takeBackupSnapshot();
}

/**
 * Alarms persist in Chrome independently of the service worker’s own
 * lifetime, so this only needs to actually create one the first time—calling
 * `chrome.alarms.create` again on every later wake-up (this runs at every
 * module load, i.e. every time the service worker restarts) would instead
 * reset its next fire time to `BACKUP_INTERVAL_MINUTES` from now each time,
 * and a heavily-interactive session can restart the service worker often
 * enough that the alarm would then rarely, if ever, actually reach its full
 * interval.
 *
 * Also clears the alarm left over under `LEGACY_BACKUP_ALARM_NAME` (a no-op
 * once it’s gone), which would otherwise keep waking the service worker
 * every interval for nothing.
 */
async function ensurePeriodicAlarm(): Promise<void> {
  await chrome.alarms.clear(LEGACY_BACKUP_ALARM_NAME);

  const existing = await chrome.alarms.get(PERIODIC_ALARM_NAME);
  if (existing === undefined) {
    await chrome.alarms.create(PERIODIC_ALARM_NAME, {
      periodInMinutes: BACKUP_INTERVAL_MINUTES,
    });
  }
}
void ensurePeriodicAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PERIODIC_ALARM_NAME) {
    void enqueue(handlePeriodicAlarm);
  }
});

// These listeners return the enqueued task’s Promise directly (rather than
// firing it and returning void) so the MV3 service worker stays alive until
// the underlying chrome.tabs/chrome.storage calls actually finish.

chrome.runtime.onStartup.addListener(() =>
  enqueue(async () => {
    debugLog("runtime.onStartup", {});
    await ensureInitialized();
  }),
);
chrome.runtime.onInstalled.addListener(() => enqueue(ensureInitialized));

// Open the side panel when the toolbar action is clicked, since we don’t
// have a popup to show instead.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.windows.onCreated.addListener((window) =>
  enqueue(async () => {
    await ensureInitialized();

    if (window.id === undefined) {
      return;
    }

    // Ending a normal-windows gap (see `isNormalWindowsGapPending`):
    // reconcile this window—and any sibling windows already open by the
    // time this runs—against every saved tree by URL the same way a real
    // browser startup would, instead of `initializeWindow`’s history-less
    // path.
    const isGapPending = await isNormalWindowsGapPending();
    debugLog(
      "windows.onCreated",
      {
        windowId: window.id,
        windowType: window.type,
        isGapPending,
      },
      { isIncognito: window.incognito },
    );
    if (isGapPending && window.type === "normal") {
      await clearNormalWindowsGapPending();
      await initializeAllWindows();
    } else {
      await initializeWindow(
        window.id,
        window.incognito,
        window.type ?? "normal",
      );
    }
  }),
);

chrome.windows.onRemoved.addListener((windowId) =>
  enqueue(async () => {
    const treeId = getTreeId(windowId);
    const isWorthKeeping = hasTaborSpecificInfo(getTree(windowId));
    const isIncognito = isIncognitoWindow(windowId);
    const windowType = getWindowType(windowId);
    deleteWindow(windowId);
    initializedWindowIds.delete(windowId);
    clearPendingClose(windowId);
    // Its tree stays saved, now as a closed window’s (see
    // `TREE_ID_KEY_PREFIX`), for a window reopened later to be matched to.
    await removeTreeIdForWindow(windowId);
    // Unless it holds nothing only Tabor knows about (see
    // `hasTaborSpecificInfo`): reopening the same tabs later would rebuild
    // an identical tree regardless, so it would only linger among closed
    // windows’ saved trees. That includes an empty tree: closing a window’s
    // last tab (rather than the window itself) fires that tab’s
    // `tabs.onRemoved` with `isWindowClosing: false` before this, so
    // `handleTabRemoved` has already saved the tree without it.
    // An incognito window’s tree is removed regardless: nothing about it
    // should outlive the window itself. So is a non-normal window’s (e.g. an
    // installed PWA’s): with no toolbar to open the side panel from, it can’t
    // hold anything added through Tabor, so there’s nothing worth keeping.
    if (
      treeId !== undefined &&
      (!isWorthKeeping || isIncognito || windowType !== "normal")
    ) {
      await removeTree(treeId);
    }

    const remainingNormalWindows = await chrome.windows.getAll({
      windowTypes: ["normal"],
    });
    debugLog(
      "windows.onRemoved",
      {
        windowId,
        remainingNormalWindows: remainingNormalWindows.length,
      },
      { isIncognito },
    );
    if (remainingNormalWindows.length === 0) {
      await markNormalWindowsGapPending();
    }
  }),
);

chrome.tabs.onCreated.addListener((tab) =>
  enqueue(() => handleTabCreated(tab)),
);
chrome.tabs.onRemoved.addListener((tabId, info) =>
  enqueue(() => handleTabRemoved(tabId, info)),
);
chrome.tabs.onMoved.addListener((tabId, info) =>
  enqueue(() => handleTabMoved(tabId, info)),
);
chrome.tabs.onAttached.addListener((tabId, info) =>
  enqueue(() => handleTabAttached(tabId, info)),
);
chrome.tabs.onDetached.addListener((tabId, info) =>
  enqueue(() => handleTabDetached(tabId, info)),
);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
  enqueue(() => handleTabUpdated(tabId, changeInfo, tab)),
);
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
  enqueue(() => handleTabReplaced(addedTabId, removedTabId)),
);

chrome.tabs.onActivated.addListener((activeInfo) =>
  enqueue(() => handleTabActivated(activeInfo)),
);

// Side-panel-driven tree changes (e.g. toggling collapsed) arrive here
// instead of through a chrome.tabs/chrome.windows event.
chrome.runtime.onMessage.addListener((message: TaborMessage) => {
  switch (message.type) {
    case "toggleCollapsed": {
      void enqueue(() => handleToggleCollapsed(message.tabId));
      break;
    }
    case "moveNode": {
      void enqueue(() => handleMoveNode(message.tabIds, message.target));
      break;
    }
    case "restoreBackup": {
      void enqueue(() =>
        handleRestoreBackup(message.windowId, message.timestamp),
      );
      break;
    }
    case "registerPendingClose": {
      registerPendingClose(message.windowId, message.tabIds);
      break;
    }
    case "updateNote": {
      void enqueue(() => handleUpdateNote(message.tabId, message.note));
      break;
    }
    case "registerPendingTreeMove": {
      registerPendingTreeMove(getTree(message.windowId), message.tabIds);
      // The tabs leave the source window one `onDetached` at a time, with
      // `await`ed moves in between that can outlast the native debounce—
      // register them as a single batch so the focus target is picked once,
      // with all of them excluded.
      registerPendingClose(message.windowId, message.tabIds);
      break;
    }
    case "removeSavedTrees": {
      void enqueue(() => handleRemoveSavedTrees(message.treeIds));
      break;
    }
  }
});
