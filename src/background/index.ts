import {
  addTab,
  removeTab,
  reorderFromNativeMove,
  updateTab,
  type TabUpdate,
} from "../shared/tree/mutations";
import { restoreTree } from "../shared/tree/restore";
import { loadTree, saveTree } from "../shared/tree/storage";
import {
  deleteWindow,
  getActiveTabId,
  getTree,
  setActiveTabId,
  setTree,
} from "./store";
import { toActualTab } from "./tabs";

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

async function initializeAllWindows(): Promise<void> {
  const windows = await chrome.windows.getAll();
  await Promise.all(
    windows
      .filter(
        (window): window is chrome.windows.Window & { id: number } =>
          window.id !== undefined,
      )
      .map((window) => initializeWindow(window.id)),
  );
}

async function handleTabCreated(tab: chrome.tabs.Tab): Promise<void> {
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
  const update = toTabUpdate(changeInfo);
  if (Object.keys(update).length === 0) {
    return;
  }

  const tree = getTree(tab.windowId);
  const updated = updateTab(tree, tabId, update);
  setTree(tab.windowId, updated);
  await saveTree(tab.windowId, updated);
}

// These listeners return the async handler's Promise directly (rather than
// firing it and returning void) so the MV3 service worker stays alive until
// the underlying chrome.tabs/chrome.storage calls actually finish.

chrome.runtime.onStartup.addListener(initializeAllWindows);
chrome.runtime.onInstalled.addListener(initializeAllWindows);

chrome.windows.onCreated.addListener(async (window) => {
  if (window.id !== undefined) {
    await initializeWindow(window.id);
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  deleteWindow(windowId);
});

chrome.tabs.onCreated.addListener(handleTabCreated);
chrome.tabs.onRemoved.addListener(handleTabRemoved);
chrome.tabs.onMoved.addListener(handleTabMoved);
chrome.tabs.onAttached.addListener(handleTabAttached);
chrome.tabs.onDetached.addListener(handleTabDetached);
chrome.tabs.onUpdated.addListener(handleTabUpdated);

chrome.tabs.onActivated.addListener((activeInfo) => {
  setActiveTabId(activeInfo.windowId, activeInfo.tabId);
});
