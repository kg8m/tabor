import {
  addTab,
  moveNodes,
  removeTab,
  reorderFromNativeMove,
  replaceTabId,
  updateTab,
  type DropTarget,
  type TabUpdate,
} from "../shared/tree/mutations";
import type { TaborMessage } from "../shared/messages";
import { getNativeOrder } from "../shared/tree/queries";
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
  getRestoreSession,
  getTree,
  setActiveTabId,
  setRestoreSession,
  setTree,
} from "./store";
import { isTaborOwnTab, toActualTab } from "./tabs";

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

  void restoreTracking.track();
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
    setActiveTabId(windowId, activeTab.id);
  }
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
async function initializeAllWindows(): Promise<void> {
  void restoreTracking.track();
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
        queriedTabs.filter((tab) => !isTaborOwnTab(tab)),
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
        setActiveTabId(actualWindow.windowId, activeTab.id);
      }
    }),
  );

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
  return async (): Promise<void> => {
    initializationPromise ??= initializeAllWindows();
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
  await ensureInitialized();

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

  const tree = getTree(info.windowId);
  const updated = removeTab(tree, tabId);
  setTree(info.windowId, updated);
  await saveTree(info.windowId, updated);
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
    setActiveTabId(tab.windowId, addedTabId);
  }
}

/**
 * `loading`/`suspended` are derived from `tab.status`/`tab.discarded`—the
 * full, current tab state—rather than from `changeInfo`, which only carries
 * whatever fields changed in this particular event. If an event that would
 * have flipped `loading` back to `false` is ever missed (e.g. the service
 * worker was asleep for it), deriving from the live `tab` object instead of
 * that one delta lets the very next `onUpdated` event for the tab—whatever
 * it's about—self-correct the stale value instead of leaving it stuck.
 */
function toTabUpdate(
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
): TabUpdate {
  const update: TabUpdate = {};
  if (changeInfo.url !== undefined) {
    update.url = changeInfo.url;
  }
  if (changeInfo.title !== undefined) {
    update.title = changeInfo.title;
  }
  if (changeInfo.favIconUrl !== undefined) {
    update.favIconUrl = changeInfo.favIconUrl;
  }
  update.loading = tab.status === "loading";
  update.suspended = tab.discarded;
  if (changeInfo.pinned !== undefined) {
    update.pinned = changeInfo.pinned;
  }
  return update;
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
 * same self-healing `toTabUpdate` does, but triggered by the tab becoming
 * active rather than waiting for its next `onUpdated` event, so a tab stuck
 * showing a stale spinner fixes itself as soon as it's clicked.
 */
async function handleTabActivated(
  activeInfo: chrome.tabs.OnActivatedInfo,
): Promise<void> {
  await ensureInitialized();

  setActiveTabId(activeInfo.windowId, activeInfo.tabId);

  const tab = await chrome.tabs.get(activeInfo.tabId);
  debugLog("onActivated", {
    tabId: activeInfo.tabId,
    windowId: activeInfo.windowId,
    status: tab.status,
    discarded: tab.discarded,
  });

  const tree = getTree(activeInfo.windowId);
  const updated = updateTab(tree, activeInfo.tabId, {
    loading: tab.status === "loading",
    suspended: tab.discarded,
  });
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
 * Pinned tabs are left out: they're independent of the tree (see `addTab`),
 * and Chrome keeps them pinned to the front regardless of the index passed
 * here.
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

  await chrome.tabs.move(order, { windowId, index: 0 });
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
  if (message.type === "toggleCollapsed") {
    void enqueue(() => handleToggleCollapsed(message.tabId));
  } else if (message.type === "moveNode") {
    void enqueue(() => handleMoveNode(message.tabIds, message.target));
  }
});
