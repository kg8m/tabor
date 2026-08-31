import {
  loadPersistedActiveTabId,
  savePersistedActiveTabId,
} from "./active-tab-storage";
import {
  loadAllBackups,
  loadBackup,
  removeBackups,
  saveBackup,
  selectBackupTimestampsToKeep,
} from "../shared/tree/backup";
import {
  addTab,
  moveNodes,
  removeTab,
  reorderFromNativeMove,
  replaceTabId,
  updateTab,
  type DropTarget,
} from "../shared/tree/mutations";
import type { TaborMessage } from "../shared/messages";
import {
  flattenDepthFirst,
  getNativeOrder,
  getPinnedNodes,
  hasHierarchy,
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
  loadAllTrees,
  loadPendingRemovals,
  markPendingRemoval,
  removeTree,
  saveTree,
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
  getAllTrees,
  getRestoreSession,
  getTree,
  isDeletedWindow,
  removeRestoreSession,
  setActiveTabId,
  setRestoreSession,
  setTree,
} from "./store";
import { toSelfHealingUpdate, toTabUpdate } from "./tab-update";
import { isTaborOwnTab, toActualTab } from "../shared/tabs";

/**
 * Records a tab becoming active both in memory (for the rest of this
 * service worker's lifetime) and in `chrome.storage.session` (for the next
 * one, see `active-tab-storage.ts`).
 */
function setAndPersistActiveTabId(windowId: number, tabId: number): void {
  setActiveTabId(windowId, tabId);
  void savePersistedActiveTabId(windowId, tabId);
}

// TODO(debug): temporary instrumentation for two intermittent, hard-to-
// reproduce bugs (a stuck loading spinner on an already-loaded tab; a
// missing active-tab indicator after closing the active tab). Remove once
// root-caused. Prefixed and timestamped so its output can be correlated
// with the side panel's own `[Tabor:sidepanel]` logs (a separate console).
const DEBUG_LOG_KEY_PREFIX = "tabor:debug:";
const DEBUG_LOG_RETENTION_MS = 12 * 60 * 60 * 1000;

const debugLog = (() => {
  let counter = 0;

  return (event: string, data: Record<string, unknown>): void => {
    // `JSON.stringify` here (rather than logging the object directly) so a
    // copy-paste of the console output carries the actual field values—an
    // inline console object otherwise collapses to a bare "Object" once
    // pasted as plain text outside DevTools.
    console.log(
      `[Tabor:background] ${event}`,
      JSON.stringify({ ...data, at: Date.now() }),
    );

    // Also persisted to `chrome.storage.local`, so it can be retrieved after
    // the fact even if nobody had the service worker's inspector open while
    // it happened—attaching that inspector itself keeps the service worker
    // alive, which can mask a bug that only shows up when it's genuinely
    // killed for going idle and restarted later. Each entry gets its own
    // unique key (timestamp + counter) rather than appending to one shared
    // array, so concurrent `debugLog` calls can't race on a read-modify-write
    // and silently drop entries—the same kind of race `enqueue` had.
    // Pruned by `pruneOldDebugLogs` (see below) so these don't accumulate
    // forever.
    const key = `${DEBUG_LOG_KEY_PREFIX}${Date.now()}-${counter}`;
    counter += 1;
    void chrome.storage.local.set({
      [key]: { event, ...data, at: Date.now() },
    });
  };
})();

// TODO(debug): removes `debugLog`'s persisted entries once they're older
// than `DEBUG_LOG_RETENTION_MS`, so leaving this instrumentation running for
// an extended stretch (waiting on an intermittent bug to recur) doesn't grow
// `chrome.storage.local` without bound. Half a day is plenty: whatever
// triggers a bug worth digging into is almost always something done not
// long before it's noticed. Piggybacks on the existing 5-minute backup
// alarm (see `handleBackupAlarm`) instead of a dedicated one.
async function pruneOldDebugLogs(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const cutoff = Date.now() - DEBUG_LOG_RETENTION_MS;
  const staleKeys = Object.keys(all).filter((key) => {
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
 * Runs each queued task after the previous one settles, so that two events
 * arriving close together (e.g. both firing right as the service worker
 * wakes from being idle) can't run their tree-store read/update/save cycles
 * concurrently and clobber each other's result with a stale one.
 *
 * Deliberately NOT an `async` function: an `await settle(queue)` before
 * chaining onto `queue` would leave a window, between that `await` and the
 * following `queue = ...` reassignment, where a burst of calls arriving
 * synchronously (e.g. the dozens of tab events Chrome fires back-to-back
 * while tearing down a window with many tabs) all read the same
 * not-yet-updated `queue` and end up chained onto *that* instead of onto
 * each other—so their bodies run concurrently instead of in the intended
 * order, racing on the same window's tree. Reassigning `queue` synchronously,
 * in the same tick as the call that reads it, closes that window: whichever
 * calls happen to arrive together are still chained one after another
 * because each sees the previous one's reassignment before returning.
 */
const enqueue = (() => {
  let queue: Promise<void> = Promise.resolve();

  // Swallow a failure so it doesn't block the tasks queued after it; the
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
 * window's native tab order, keyed by window id, after `syncNativeOrder`
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
 * `reorderFromNativeMove` against a move that isn't a genuine user drag at
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
 * `handleTabCreated` checks `isRestoring()` before falling back to "parent =
 * whatever's active" for a tab it can't otherwise account for.
 *
 * `track()` keeps `isRestoring()` true until tab creation has gone fully
 * quiet (see `waitForTabCreationToFullySettle`), independently of—and
 * typically outlasting—the single settle round
 * `initializeAllWindows`/`initializeWindow` themselves wait for before
 * taking their own snapshot. A large session restore can burst, pause, and
 * burst again well past that first round, and while `handleTabCreated` has
 * no saved history to reconnect a straggler tab to (see `matchStraggler`),
 * the next best thing is to at least not mistake it for a genuinely new tab
 * and stack it under whatever's active.
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
 * objects (satisfying `waitForTabCreationToSettle`) before it's finished
 * populating each one's destination, especially when many of them are kept
 * discarded/unloaded rather than all loading at once. Matching a window
 * while any of its tabs are in that state makes every saved-tree candidate
 * score zero overlap, which `matchWindows` can't tell apart from a
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
      // first attempt) isn't interesting.
      if (hasUnresolvedTab || attempt > 0) {
        debugLog("queryTabsWithResolvedUrls", {
          windowId,
          attempt,
          hasUnresolvedTab,
          tabCount: tabs.length,
        });
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
 * `matchWindows`) against every saved tree not already claimed by another
 * active window—not just whatever's saved under this brand-new window id
 * itself, which is normally nothing. A window can show up already holding a
 * previous session's full set of tabs (e.g. a profile switch recreating them
 * for a browser process that was already running, so `windows.onCreated`
 * fires instead of `runtime.onStartup`), and that saved parent/child
 * structure lives under whichever old window id it was last saved under, not
 * this one.
 *
 * Waits for its own tab creation to settle first (see
 * `waitForTabCreationToSettle`) so a window opened with several tabs at once
 * (e.g. from a bookmark folder) doesn't have the later ones missed by this
 * function's own `tabs.query` and then mishandled as ordinary new tabs by
 * `handleTabCreated`.
 *
 * Also simply never reruns for a window `initializeAllWindows` already
 * restored (see `initializedWindowIds` above). Chrome fires `windows.onCreated`
 * for a startup window too, not just ones genuinely opened later, and rerunning
 * this window's own restore right after `initializeAllWindows` already did it
 * is at best wasted work reconciling the same tabs a second time.
 */
async function initializeWindow(windowId: number): Promise<void> {
  if (initializedWindowIds.has(windowId)) {
    return;
  }
  initializedWindowIds.add(windowId);
  clearDeletedWindow(windowId);

  const settled = restoreTracking.track();
  await waitForTabCreationToSettle();
  const queriedTabs = await chrome.tabs.query({ windowId });
  const tabs = queriedTabs.filter((tab) => !isTaborOwnTab(tab));
  const actualTabs = tabs.map((tab) => toActualTab(tab));

  const savedTreesByWindowId = await loadAllTrees();
  // Excludes trees already claimed by another window this session, so this
  // window can't steal a match that rightfully belongs to one already up and
  // running—but still considers a tree saved under this exact window id
  // (unlikely for a brand-new one, but harmless to include).
  const savedWindows: SavedWindow[] = Object.entries(savedTreesByWindowId)
    .map(([savedWindowIdString, savedTree]) => ({
      windowId: Number(savedWindowIdString),
      tree: savedTree,
    }))
    .filter(
      (saved) =>
        saved.windowId === windowId ||
        !initializedWindowIds.has(saved.windowId),
    );

  const [match] = matchWindows(savedWindows, [{ windowId, tabs: actualTabs }]);
  const savedTree = match?.savedTree ?? { nodes: {}, rootIds: [] };

  const savedNodeCount = Object.keys(savedTree.nodes).length;
  debugLog("initializeWindow", {
    windowId,
    matchedSavedWindowId: match?.savedWindowId,
    savedNodeCount,
    candidateSavedWindowIds: savedWindows.map((saved) => saved.windowId),
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
            savedWindowId: saved.windowId,
            savedNodeCount: savedUrls.size,
            overlap,
          };
        }),
      }),
  });
  const session = createRestoreSession(savedTree);
  const tree = restoreTree(savedTree, actualTabs, session);

  setTree(windowId, tree);
  setRestoreSession(windowId, session);
  await saveTree(windowId, tree);

  // The saved tree now lives under this window's own id (just saved above);
  // its old id would otherwise sit in storage as a stale duplicate until some
  // later `initializeAllWindows` cleanup happened to find it.
  if (match?.savedWindowId !== undefined && match.savedWindowId !== windowId) {
    await removeTree(match.savedWindowId);
  }

  const activeTab = tabs.find((tab) => tab.active);
  if (activeTab?.id !== undefined) {
    setAndPersistActiveTabId(windowId, activeTab.id);
  }

  // Once tab creation has gone fully quiet, this window's restore session
  // has caught every straggler it's going to—any tab created from here on
  // is a genuinely new one, not a late arrival from session restore. Drop
  // it so a tab opened much later can't be mismatched against one of its
  // leftover saved nodes that was never consumed (see `removeRestoreSession`).
  void settled.then(() => removeRestoreSession(windowId));
}

// How long a saved tree may sit unmatched (see `markPendingRemoval`) before
// `initializeAllWindows` treats it as genuinely stale and deletes it. Long
// enough that a window the user only reopens occasionally—rather than every
// single browser restart—doesn't lose its saved parent/child structure just
// because other windows (e.g. an installed PWA's) happened to reopen ahead
// of it a couple of times first.
const PENDING_REMOVAL_GRACE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Initialize every window at browser startup, matching saved windows to
 * actual windows by tab URL overlap first (window ids don't survive a
 * restart, so we can't just look up each window's tree by id).
 *
 * Waits for tab creation to settle first (see `waitForTabCreationToSettle`),
 * since Chrome's own session restore recreates each previously open tab
 * asynchronously and querying tabs immediately on `runtime.onStartup` can
 * catch some windows before all of their tabs exist yet—but that wait has no
 * hard guarantee of catching every one of them (how long restore actually
 * takes isn't something this can know in advance). So a `RestoreSession` is
 * also kept around per window afterward (see `getRestoreSession`): any saved
 * tab this pass didn't find a match for is still there, ready for
 * `handleTabCreated` to match a straggler against once it actually shows up,
 * rather than that straggler falling through to being treated as an
 * ordinary brand-new tab (parented under whatever's active) and losing its
 * real saved parent. And for a tab with no saved match at all—there's
 * nothing unusual about a late-arriving tab having none, since plenty of
 * tabs are new every session—`restoreTracking` keeps `handleTabCreated` from
 * treating it as an ordinary new tab either, for as long as tab creation is
 * still ongoing.
 */
async function initializeAllWindows(excludeTabId?: number): Promise<void> {
  const settled = restoreTracking.track();
  // TODO(debug): temporary instrumentation, see the block near the top of
  // this file—how many `tabs.onCreated` events this actually observed before
  // deciding tab creation had settled, to see whether a window with many
  // tabs can finish being recreated by session restore in a single burst
  // this misses most of (e.g. because most of them already existed by the
  // time this call's own listener got registered).
  const observedTabCreatedCount = await waitForTabCreationToSettle();
  debugLog("initializeAllWindows:settled", { observedTabCreatedCount });
  const windows = await chrome.windows.getAll();
  const windowIds = windows
    .map((window) => window.id)
    .filter((id): id is number => id !== undefined);

  const tabsByWindowId = new Map<number, chrome.tabs.Tab[]>();
  await Promise.all(
    windowIds.map(async (windowId) => {
      const queriedTabs = await queryTabsWithResolvedUrls(windowId);
      tabsByWindowId.set(
        windowId,
        // `excludeTabId` leaves out whichever tab's own `onCreated` event is
        // driving this call (see `handleTabCreated`): when the service
        // worker had to wake up to deliver that very event, this query can
        // otherwise already see that brand-new tab too, folding it into this
        // startup-style reconciliation—as an unmatched, parentless root,
        // since a genuinely new tab has nothing to match in the saved
        // tree—instead of `handleTabCreated`'s own "parent = current tab"
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
  }));

  const savedTreesByWindowId = await loadAllTrees();
  const savedWindows: SavedWindow[] = Object.entries(savedTreesByWindowId).map(
    ([windowId, tree]) => ({ windowId: Number(windowId), tree }),
  );

  const matches = matchWindows(savedWindows, actualWindows);
  const matchByActualWindowId = new Map(
    matches.map((match) => [match.actualWindowId, match]),
  );

  debugLog("initializeAllWindows", {
    actualWindowIds: windowIds,
    savedWindowIds: savedWindows.map((window) => window.windowId),
    matches: matches.map((match) => ({
      actualWindowId: match.actualWindowId,
      savedWindowId: match.savedWindowId,
    })),
  });

  await Promise.all(
    actualWindows.map(async (actualWindow) => {
      const savedTree = matchByActualWindowId.get(actualWindow.windowId)
        ?.savedTree ?? { nodes: {}, rootIds: [] };
      const session = createRestoreSession(savedTree);
      const tree = restoreTree(savedTree, actualWindow.tabs, session);

      const savedNodeCount = Object.keys(savedTree.nodes).length;
      debugLog("initializeAllWindows:restored", {
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
                savedWindowId: saved.windowId,
                savedNodeCount: savedUrls.size,
                overlap,
              };
            }),
          }),
      });

      setTree(actualWindow.windowId, tree);
      setRestoreSession(actualWindow.windowId, session);
      await saveTree(actualWindow.windowId, tree);
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

  // A saved window's data now lives under its matched actual window's id
  // (just saved above, under `actualWindow.windowId`)—including when that
  // differs from the saved window's own old id, which is the common case
  // across a restart. Anything saved under an id that isn't one of the
  // actual windows just initialized is a removal *candidate*—but, unless it
  // has no parent/child structure worth losing (see `hasHierarchy`), not
  // deleted outright (see `markPendingRemoval`): a window whose session
  // restore hadn't finished recreating it in time for this pass's own
  // snapshot (e.g. because another window, like a lightweight installed-PWA
  // window, was recreated first—possibly repeatedly across several browser
  // restarts before the real window ever reopens) would otherwise have its
  // real saved tree deleted as stale before it ever got a chance to be
  // matched. Only deleted once its mark is older than
  // `PENDING_REMOVAL_GRACE_MS`, not merely on the next miss—an installed-PWA
  // window reopening on every restart ahead of a real window the user only
  // opens occasionally would otherwise still rack up two straight misses
  // for it in no time at all. A flat tree has nothing to lose that way—
  // reopening those same tabs later would rebuild an identical flat tree
  // regardless of whether this saved one still exists—so it's simply
  // deleted right away instead of accumulating pending-removal clutter for
  // windows that keep never quite matching (e.g. a one-off popup or
  // print-preview window whose exact tab set never recurs).
  const actualWindowIds = new Set(windowIds);
  const unmatchedSavedWindows = savedWindows.filter(
    (saved) => !actualWindowIds.has(saved.windowId),
  );
  const previouslyPendingRemoval = await loadPendingRemovals();

  await Promise.all([
    ...unmatchedSavedWindows.map((saved) => {
      if (!hasHierarchy(saved.tree)) {
        return removeTree(saved.windowId);
      }
      const markedAt = previouslyPendingRemoval.get(saved.windowId);
      if (
        markedAt !== undefined &&
        Date.now() - markedAt >= PENDING_REMOVAL_GRACE_MS
      ) {
        return removeTree(saved.windowId);
      }
      return markPendingRemoval(saved.windowId);
    }),
    // A saved window matched this time around is no longer a removal
    // candidate, even if a previous pass had marked it pending.
    ...matches.flatMap((match) =>
      match.savedWindowId === undefined
        ? []
        : [clearPendingRemoval(match.savedWindowId)],
    ),
  ]);
}

// Whether the one genuine, URL-matching startup reconciliation
// (`initializeAllWindows`) has already happened this browser session.
// `chrome.storage.session` is the right place to track it: unlike
// `chrome.storage.local`, it's cleared when the browser itself restarts,
// but—unlike an in-memory flag here—it survives the service worker being
// killed and restarted for merely going idle, which happens constantly
// during ordinary use and isn't a real restart at all.
const SESSION_RECONCILED_KEY = "tabor:session:reconciled";

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
 * browser session's one genuine startup reconciliation has already
 * happened (see `hasReconciledThisBrowserSession`): the service worker
 * going idle and being killed, then waking back up for the next event,
 * doesn't change any window's or tab's identity the way an actual browser
 * restart does, so there's no need to re-match anything by URL—the
 * persisted trees are already accurate as of the last save, and just need
 * to be read back into memory.
 *
 * Doing this instead of `initializeAllWindows` also sidesteps
 * `restoreTracking`: that call would otherwise mark tab creation as
 * "restoring" for a good several hundred milliseconds after every single
 * idle wake-up—including the wake-up caused by an entirely ordinary new
 * tab's own `onCreated` event—which left `handleTabCreated` unable to tell
 * that case apart from a genuine session-restore burst, and made it treat
 * that one ordinary tab as parentless instead of a child of the current
 * tab.
 */
async function reloadFromStorage(): Promise<void> {
  const [savedTrees, windows] = await Promise.all([
    loadAllTrees(),
    chrome.windows.getAll(),
  ]);
  const windowIds = new Set(
    windows
      .map((window) => window.id)
      .filter((id): id is number => id !== undefined),
  );

  await Promise.all(
    Object.entries(savedTrees)
      .map(([windowIdString, tree]) => [Number(windowIdString), tree] as const)
      .filter(([windowId]) => windowIds.has(windowId))
      .map(async ([windowId, tree]) => {
        setTree(windowId, tree);
        initializedWindowIds.add(windowId);

        // The *persisted* active tab id, not a fresh `chrome.tabs.query`:
        // whichever event just woke the service worker up may itself have
        // already changed which tab is live-active (e.g. a new foreground
        // tab is active from the moment it's created), which would make a
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
  // (see `reloadFromStorage` for why the other path doesn't need it at
  // all). A later, already-in-flight or already-resolved call just awaits
  // the same promise as before.
  return async (excludeTabId?: number): Promise<void> => {
    initializationPromise ??= (async () => {
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

// Whether the profile's normal windows (not counting e.g. an installed PWA's
// own app-type window in the same profile) have dropped to zero since the
// last time one was open. Set by `chrome.windows.onRemoved` below and
// consumed by `chrome.windows.onCreated`: closing every normal window
// doesn't necessarily end the browser process—an installed PWA sharing the
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
// got consumed—see `SESSION_RECONCILED_KEY` above for the same reasoning.
//
// Deliberately kept independent of `hasReconciledThisBrowserSession`'s own
// flag, rather than reusing or clearing it directly: any other event
// arriving in the meantime (e.g. the PWA's own tab updating its title or
// favicon) also calls `ensureInitialized`, and if that flag were cleared
// here instead, such an unrelated event could run `initializeAllWindows`
// first—matching only that PWA window against every saved tree and then, in
// its own stale-window cleanup, permanently deleting every real window's
// saved tree before the user gets a chance to reopen it.
const NORMAL_WINDOWS_GAP_KEY = "tabor:session:normalWindowsGapPending";

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
  // Already tracked, most likely because this tab's own `onCreated` fired
  // during startup's tab-creation settle wait (see
  // `waitForTabCreationToSettle`) and it was therefore already picked up by
  // `initializeAllWindows`/`initializeWindow`'s own tab query. Adding it
  // again here would duplicate it under a brand-new node, parented under
  // whatever's active rather than wherever the tree just restored it to.
  if (tree.nodes[tab.id] !== undefined) {
    return;
  }

  const actualTab = toActualTab(tab);
  const session = getRestoreSession(tab.windowId);
  const straggler = session && matchStraggler(session, actualTab);

  if (straggler || restoreTracking.isRestoring()) {
    // Either a tab from startup's own session restore that this window's
    // initial restore pass (see `getRestoreSession`) didn't get to see yet,
    // reconnected here to its real saved parent—or, if no saved match was
    // found, one Chrome is still busy creating as part of that same restore
    // (see `restoreTracking`), where falling through to "parent =
    // whatever's active" below risks stacking a pile of unrelated restored
    // tabs under it.
    const parentId = straggler ? straggler.parentId : null;
    let updated = addTab(tree, actualTab, parentId);

    if (!straggler && !actualTab.pinned) {
      // A genuinely new tab with no saved match (e.g. a browser-injected
      // page like Chrome's "What's New" tab after an update) still has a
      // real native position among the tabs restored so far. `addTab` just
      // appends it as the last root, which is wrong whenever it actually
      // sits in the middle of the tab strip. Reuse `reorderFromNativeMove`'s
      // placement logic to correct that purely in the tree data—this
      // deliberately doesn't call `syncNativeOrder` (see below), since the
      // window may still be mid-restore and this shouldn't reshuffle it.
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
    await saveTree(tab.windowId, updated);
    return;
  }

  const parentId = getActiveTabId(tab.windowId) ?? null;
  const updated = addTab(tree, actualTab, parentId);
  setTree(tab.windowId, updated);
  await saveTree(tab.windowId, updated);

  // `addTab` places the tab in the tree (e.g. as its parent's last child),
  // but Chrome creates it wherever it likes natively—often the far end of
  // the tab strip for a blank tab (Ctrl+T), not next to its parent. Without
  // this, the tree and the native tab bar would disagree about this tab's
  // position until some unrelated move reconciled them, which broke
  // Ctrl+Tab and similar native, position-based navigation.
  await syncNativeOrder(updated, tab.windowId);
}

async function handleTabRemoved(
  tabId: number,
  info: chrome.tabs.OnRemovedInfo,
): Promise<void> {
  await ensureInitialized();
  debugLog("onRemoved", {
    tabId,
    windowId: info.windowId,
    isWindowClosing: info.isWindowClosing,
  });

  // The window itself is being torn down; `windows.onRemoved` will drop its
  // tree, so there's no need to reconcile it tab by tab here.
  if (info.isWindowClosing || isDeletedWindow(info.windowId)) {
    return;
  }

  noteTabRemoved(info.windowId, tabId);

  const tree = getTree(info.windowId);
  const updated = removeTab(tree, tabId);
  setTree(info.windowId, updated);
  await saveTree(info.windowId, updated);

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
  await saveTree(info.windowId, updated);
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
  await saveTree(info.newWindowId, updated);

  // Part of a "move tab(s)/tree(s) to window" batch (see
  // `pending-tree-move.ts`)—once every tab in it has landed here as a root,
  // reconstruct their original relative parent/child structure instead of
  // leaving them all flattened.
  const reparented = noteTreeMoveAttached(tabId, info.newWindowId);
  if (reparented !== undefined) {
    setTree(info.newWindowId, reparented);
    await saveTree(info.newWindowId, reparented);
    await syncNativeOrder(reparented, info.newWindowId);
  }
}

async function handleTabDetached(
  tabId: number,
  info: chrome.tabs.OnDetachedInfo,
): Promise<void> {
  await ensureInitialized();

  if (isDeletedWindow(info.oldWindowId)) {
    return;
  }

  const tree = getTree(info.oldWindowId);
  const updated = removeTab(tree, tabId);
  setTree(info.oldWindowId, updated);
  await saveTree(info.oldWindowId, updated);
}

/**
 * Chrome fires this instead of a remove/create pair when it swaps a tab's
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
  await saveTree(tab.windowId, updated);

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
  debugLog("onUpdated", {
    tabId,
    changeInfo,
    status: tab.status,
    discarded: tab.discarded,
  });

  if (isDeletedWindow(tab.windowId)) {
    return;
  }

  const update = toTabUpdate(changeInfo, tab);
  const tree = getTree(tab.windowId);
  const updated = updateTab(tree, tabId, update);
  setTree(tab.windowId, updated);
  await saveTree(tab.windowId, updated);
}

/**
 * Besides tracking the active tab, re-reads the activated tab's actual
 * loading/discarded state and corrects the tree if it's out of sync—the
 * same self-healing `toSelfHealingUpdate` applies to an `onUpdated` event
 * with nothing more specific to go on, but triggered by the tab becoming
 * active rather than waiting for its next `onUpdated` event, so a tab stuck
 * showing a stale spinner fixes itself as soon as it's clicked.
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
  debugLog("onActivated", {
    tabId: activeInfo.tabId,
    windowId: activeInfo.windowId,
    status: tab.status,
    discarded: tab.discarded,
  });

  const tree = getTree(activeInfo.windowId);
  const updated = updateTab(tree, activeInfo.tabId, toSelfHealingUpdate(tab));
  setTree(activeInfo.windowId, updated);
  await saveTree(activeInfo.windowId, updated);
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
  await saveTree(tab.windowId, updated);
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
  await saveTree(tab.windowId, updated);
}

/**
 * Move the window's non-pinned tabs to match the tree's depth-first order.
 * Used after a side-panel drag-and-drop changes the tree, since that only
 * updates our own state—chrome.tabs.onMoved tells us about the opposite
 * direction (native move -> tree update), not this one.
 *
 * Pinned tabs are left out: they're independent of the tree (see `addTab`)
 * and always occupy the window's frontmost slots, ahead of every id in
 * `order`—so each target index is offset by how many of them there are,
 * rather than assuming Chrome slots a non-pinned tab in after them on its
 * own regardless of the index we ask for.
 */
async function syncNativeOrder(
  tree: TreeState,
  windowId: number,
): Promise<void> {
  const order = getNativeOrder(tree).filter(
    (id) => tree.nodes[id]?.pinned !== true,
  );
  if (order.length === 0) {
    return;
  }

  const pinnedCount = getPinnedNodes(tree).length;

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
  // each call unambiguously means "put this one tab at this index".
  for (const [offset, id] of order.entries()) {
    const index = pinnedCount + offset;
    try {
      await chrome.tabs.move(id, { windowId, index });
    } catch (error) {
      // The id no longer resolving to a real tab (e.g. the tree holding a
      // stale id for a tab that's since closed or moved to another window)
      // shouldn't stop the rest of `order` from reaching their own target
      // index, which a thrown error here would otherwise skip entirely.
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
 * Reconciles a chosen backup's tree for one window with that window's tabs
 * as they actually stand right now, the same way a saved tree is reconciled
 * with actual tabs at startup (see `restoreTree`)—so a tab opened/closed
 * since the backup was taken doesn't cause a mismatch, and pinned/suspended
 * state stays whatever it actually is now rather than reverting to the
 * backup's.
 *
 * The backup's own window ids can't be looked up directly against the
 * current window: like tab ids, they don't survive a browser restart. Used
 * the same URL-overlap matching (`matchWindows`) startup restore already
 * relies on for the same reason, rather than assuming the backup's
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
    ([savedWindowId, tree]) => ({ windowId: Number(savedWindowId), tree }),
  );

  const queriedTabs = await chrome.tabs.query({ windowId });
  const actualTabs = queriedTabs
    .filter((tab) => !isTaborOwnTab(tab))
    .map((tab) => toActualTab(tab));

  const [match] = matchWindows(savedWindows, [{ windowId, tabs: actualTabs }]);
  const savedTree = match?.savedTree ?? { nodes: {}, rootIds: [] };

  const restored = restoreTree(savedTree, actualTabs);
  setTree(windowId, restored);
  await saveTree(windowId, restored);
  await syncNativeOrder(restored, windowId);
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

  // All dragged tabs come from the same side panel, so they're always in
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
  await saveTree(tab.windowId, updated);
  await syncNativeOrder(updated, tab.windowId);
}

const BACKUP_ALARM_NAME = "tabor-backup-snapshot";
const BACKUP_INTERVAL_MINUTES = 5;

/**
 * Snapshots every window's tree for on-demand restore later, then thins out
 * older snapshots (see `selectBackupTimestampsToKeep`) so the backup history
 * doesn't grow without bound.
 *
 * Skipped while every normal window is momentarily gone (see
 * `isNormalWindowsGapPending`—e.g. between closing the last one and a
 * profile switch reopening it): `getAllTrees()` at that instant would hold
 * only whatever lightweight windows (installed PWAs, etc.) happen to still
 * be open, silently dropping the real window's tree from this snapshot
 * instead of the alarm simply catching it on its next tick.
 */
async function handleBackupAlarm(): Promise<void> {
  await ensureInitialized();
  await pruneOldDebugLogs();

  if (await isNormalWindowsGapPending()) {
    return;
  }

  const windows = getAllTrees();
  if (Object.keys(windows).length === 0) {
    return;
  }

  await saveBackup(Date.now(), windows);

  const backups = await loadAllBackups();
  const timestamps = backups.map((backup) => backup.timestamp);
  const kept = new Set(selectBackupTimestampsToKeep(timestamps, Date.now()));
  const toRemove = timestamps.filter((timestamp) => !kept.has(timestamp));
  if (toRemove.length > 0) {
    await removeBackups(toRemove);
  }
}

/**
 * Alarms persist in Chrome independently of the service worker's own
 * lifetime, so this only needs to actually create one the first time—calling
 * `chrome.alarms.create` again on every later wake-up (this runs at every
 * module load, i.e. every time the service worker restarts) would instead
 * reset its next fire time to `BACKUP_INTERVAL_MINUTES` from now each time,
 * and a heavily-interactive session can restart the service worker often
 * enough that the alarm would then rarely, if ever, actually reach its full
 * interval.
 */
async function ensureBackupAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(BACKUP_ALARM_NAME);
  if (existing === undefined) {
    await chrome.alarms.create(BACKUP_ALARM_NAME, {
      periodInMinutes: BACKUP_INTERVAL_MINUTES,
    });
  }
}
void ensureBackupAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BACKUP_ALARM_NAME) {
    void enqueue(handleBackupAlarm);
  }
});

// These listeners return the enqueued task's Promise directly (rather than
// firing it and returning void) so the MV3 service worker stays alive until
// the underlying chrome.tabs/chrome.storage calls actually finish.

chrome.runtime.onStartup.addListener(() =>
  enqueue(async () => {
    debugLog("runtime.onStartup", {});
    await ensureInitialized();
  }),
);
chrome.runtime.onInstalled.addListener(() => enqueue(ensureInitialized));

// Open the side panel when the toolbar action is clicked, since we don't
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
    // browser startup would, instead of `initializeWindow`'s history-less
    // path.
    const isGapPending = await isNormalWindowsGapPending();
    debugLog("windows.onCreated", {
      windowId: window.id,
      windowType: window.type,
      isGapPending,
    });
    if (isGapPending && window.type === "normal") {
      await clearNormalWindowsGapPending();
      await initializeAllWindows();
    } else {
      await initializeWindow(window.id);
    }
  }),
);

chrome.windows.onRemoved.addListener((windowId) =>
  enqueue(async () => {
    deleteWindow(windowId);
    initializedWindowIds.delete(windowId);
    clearPendingClose(windowId);

    const remainingNormalWindows = await chrome.windows.getAll({
      windowTypes: ["normal"],
    });
    debugLog("windows.onRemoved", {
      windowId,
      remainingNormalWindows: remainingNormalWindows.length,
    });
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
      break;
    }
  }
});
