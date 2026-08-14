import {
  addTab,
  moveNodes,
  removeTab,
  reorderFromNativeMove,
  updateTab,
  type DropTarget,
  type TabUpdate,
} from "../shared/tree/mutations";
import type { TaborMessage } from "../shared/messages";
import { getNativeOrder } from "../shared/tree/queries";
import { restoreTree } from "../shared/tree/restore";
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
