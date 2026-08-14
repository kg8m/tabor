import type { RestoreSession } from "../shared/tree/restore";
import type { TreeState } from "../shared/tree/types";

const EMPTY_TREE: TreeState = { nodes: {}, rootIds: [] };

const trees = new Map<number, TreeState>();
const activeTabIds = new Map<number, number>();
const restoreSessions = new Map<number, RestoreSession>();

export function getTree(windowId: number): TreeState {
  return trees.get(windowId) ?? EMPTY_TREE;
}

export function setTree(windowId: number, tree: TreeState): void {
  trees.set(windowId, tree);
}

export function getActiveTabId(windowId: number): number | undefined {
  return activeTabIds.get(windowId);
}

export function setActiveTabId(windowId: number, tabId: number): void {
  activeTabIds.set(windowId, tabId);
}

export function getRestoreSession(
  windowId: number,
): RestoreSession | undefined {
  return restoreSessions.get(windowId);
}

export function setRestoreSession(
  windowId: number,
  session: RestoreSession,
): void {
  restoreSessions.set(windowId, session);
}

export function deleteWindow(windowId: number): void {
  trees.delete(windowId);
  activeTabIds.delete(windowId);
  restoreSessions.delete(windowId);
}
