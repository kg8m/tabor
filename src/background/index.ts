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
import { getNativeOrder, getPinnedNodes } from "../shared/tree/queries";
import {
  clearPendingClose,
  noteTabRemoved,
  registerPendingClose,
  settlePendingClose,
} from "./pending-close";
import {
  createRestoreSession,
  matchStraggler,
  restoreTree,
} from "../shared/tree/restore";
import {
  loadAllTrees,
  loadTree,
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
  deleteWindow,
  getActiveTabId,
  getAllTrees,
  getRestoreSession,
  getTree,
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
function debugLog(event: string, data: Record<string, unknown>): void {
  console.log(`[Tabor:background] ${event}`, { ...data, at: Date.now() });
}

/**
 * Runs each queued task after the previous one settles, so that two events
 * arriving close together (e.g. both firing right as the service worker
 * wakes from being idle) can't run their tree-store read/update/save cycles
 * concurrently and clobber each other's result with a stale one.
 */
const enqueue = (() => {
  let queue: Promise<void> = Promise.resolve();

  // Swallow a failure so it doesn't block the tasks queued after it; the
  // caller of `enqueue` still sees the original error via `result` below.
  async function settle(promise: Promise<void>): Promise<void> {
    try {
      await promise;
    } catch {
      // ignored, see above
    }
  }

  return async (task: () => Promise<void>): Promise<void> => {
    await settle(queue);
    const result = task();
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

/**
 * Initialize a single new window with no history to reconcile against
 * (there's nothing saved yet under its brand-new window id). Waits for its
 * own tab creation to settle first (see `waitForTabCreationToSettle`) so a
 * window opened with several tabs at once (e.g. from a bookmark folder)
 * doesn't have the later ones missed by this function's own `tabs.query` and
 * then mishandled as ordinary new tabs by `handleTabCreated`.
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

  const settled = restoreTracking.track();
  await waitForTabCreationToSettle();
  const queriedTabs = await chrome.tabs.query({ windowId });
  const tabs = queriedTabs.filter((tab) => !isTaborOwnTab(tab));
  const actualTabs = tabs.map((tab) => toActualTab(tab));

  const savedTree = (await loadTree(windowId)) ?? { nodes: {}, rootIds: [] };
  const session = createRestoreSession(savedTree);
  const tree = restoreTree(savedTree, actualTabs, session);

  setTree(windowId, tree);
  setRestoreSession(windowId, session);
  await saveTree(windowId, tree);

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
  await waitForTabCreationToSettle();
  const windows = await chrome.windows.getAll();
  const windowIds = windows
    .map((window) => window.id)
    .filter((id): id is number => id !== undefined);

  const tabsByWindowId = new Map<number, chrome.tabs.Tab[]>();
  await Promise.all(
    windowIds.map(async (windowId) => {
      const queriedTabs = await chrome.tabs.query({ windowId });
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

  await Promise.all(
    actualWindows.map(async (actualWindow) => {
      const savedTree = matchByActualWindowId.get(actualWindow.windowId)
        ?.savedTree ?? { nodes: {}, rootIds: [] };
      const session = createRestoreSession(savedTree);
      const tree = restoreTree(savedTree, actualWindow.tabs, session);

      setTree(actualWindow.windowId, tree);
      setRestoreSession(actualWindow.windowId, session);
      await saveTree(actualWindow.windowId, tree);
      initializedWindowIds.add(actualWindow.windowId);

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
  // actual windows just initialized is therefore stale, whether or not it
  // got matched to one of them.
  const actualWindowIds = new Set(windowIds);
  await Promise.all(
    savedWindows
      .filter((saved) => !actualWindowIds.has(saved.windowId))
      .map((saved) => removeTree(saved.windowId)),
  );
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
      if (await hasReconciledThisBrowserSession()) {
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

async function handleTabCreated(tab: chrome.tabs.Tab): Promise<void> {
  await ensureInitialized(tab.id);

  if (tab.id === undefined || isTaborOwnTab(tab)) {
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
    // tabs under it. Its native position is left alone either way, rather
    // than reshuffling a window that may still be mid-restore.
    const parentId = straggler ? straggler.parentId : null;
    const updated = addTab(tree, actualTab, parentId);
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
  if (info.isWindowClosing) {
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
  if (isSuppressed) {
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

  const tab = await chrome.tabs.get(tabId);
  const tree = getTree(info.newWindowId);
  const updated = addTab(tree, toActualTab(tab), null);
  setTree(info.newWindowId, updated);
  await saveTree(info.newWindowId, updated);
}

async function handleTabDetached(
  tabId: number,
  info: chrome.tabs.OnDetachedInfo,
): Promise<void> {
  await ensureInitialized();

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
 */
async function handleBackupAlarm(): Promise<void> {
  await ensureInitialized();

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

chrome.runtime.onStartup.addListener(() => enqueue(ensureInitialized));
chrome.runtime.onInstalled.addListener(() => enqueue(ensureInitialized));

// Open the side panel when the toolbar action is clicked, since we don't
// have a popup to show instead.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.windows.onCreated.addListener((window) =>
  enqueue(async () => {
    await ensureInitialized();
    if (window.id !== undefined) {
      await initializeWindow(window.id);
    }
  }),
);

chrome.windows.onRemoved.addListener((windowId) => {
  deleteWindow(windowId);
  initializedWindowIds.delete(windowId);
  clearPendingClose(windowId);
});

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
  }
});
