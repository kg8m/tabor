import {
  addTab,
  removeTab,
  reorderFromNativeMove,
  updateTab,
  type TabUpdate,
} from "../shared/tree/mutations";
import { restoreTree } from "../shared/tree/restore";
import {
  loadAllTrees,
  loadTree,
  removeTree,
  saveTree,
} from "../shared/tree/storage";
import {
  matchWindows,
  type ActualWindow,
  type SavedWindow,
} from "../shared/tree/window-matching";
import {
  deleteWindow,
  getActiveTabId,
  getTree,
  setActiveTabId,
  setTree,
} from "./store";
import { toActualTab } from "./tabs";

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
 * Initialize a single new window with no history to reconcile against
 * (there's nothing saved yet under its brand-new window id).
 */
async function initializeWindow(windowId: number): Promise<void> {
  const tabs = await chrome.tabs.query({ windowId });
  const actualTabs = tabs.map((tab) => toActualTab(tab));

  const savedTree = (await loadTree(windowId)) ?? { nodes: {}, rootIds: [] };
  const tree = restoreTree(savedTree, actualTabs);

  setTree(windowId, tree);
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
 */
async function initializeAllWindows(): Promise<void> {
  const windows = await chrome.windows.getAll();
  const windowIds = windows
    .map((window) => window.id)
    .filter((id): id is number => id !== undefined);

  const tabsByWindowId = new Map<number, chrome.tabs.Tab[]>();
  await Promise.all(
    windowIds.map(async (windowId) => {
      tabsByWindowId.set(windowId, await chrome.tabs.query({ windowId }));
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
      const tree = restoreTree(savedTree, actualWindow.tabs);

      setTree(actualWindow.windowId, tree);
      await saveTree(actualWindow.windowId, tree);

      const tabs = tabsByWindowId.get(actualWindow.windowId) ?? [];
      const activeTab = tabs.find((tab) => tab.active);
      if (activeTab?.id !== undefined) {
        setActiveTabId(actualWindow.windowId, activeTab.id);
      }
    }),
  );

  const usedSavedWindowIds = new Set(
    matches
      .map((match) => match.savedWindowId)
      .filter((id): id is number => id !== undefined),
  );
  await Promise.all(
    savedWindows
      .filter((saved) => !usedSavedWindowIds.has(saved.windowId))
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

  if (tab.id === undefined) {
    return;
  }

  const parentId = getActiveTabId(tab.windowId) ?? null;
  const tree = getTree(tab.windowId);
  const updated = addTab(tree, toActualTab(tab), parentId);
  setTree(tab.windowId, updated);
  await saveTree(tab.windowId, updated);
}

async function handleTabRemoved(
  tabId: number,
  info: chrome.tabs.OnRemovedInfo,
): Promise<void> {
  await ensureInitialized();

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

function toTabUpdate(changeInfo: chrome.tabs.OnUpdatedInfo): TabUpdate {
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
  if (changeInfo.status !== undefined) {
    update.loading = changeInfo.status === "loading";
  }
  if (changeInfo.discarded !== undefined) {
    update.suspended = changeInfo.discarded;
  }
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

  const update = toTabUpdate(changeInfo);
  if (Object.keys(update).length === 0) {
    return;
  }

  const tree = getTree(tab.windowId);
  const updated = updateTab(tree, tabId, update);
  setTree(tab.windowId, updated);
  await saveTree(tab.windowId, updated);
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

chrome.tabs.onActivated.addListener((activeInfo) =>
  enqueue(async () => {
    await ensureInitialized();
    setActiveTabId(activeInfo.windowId, activeInfo.tabId);
  }),
);
