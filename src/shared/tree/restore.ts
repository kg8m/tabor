import { addTab, removeTab, type NewTabInput } from "./mutations";
import { flattenDepthFirst } from "./queries";
import type { TabNode, TreeState } from "./types";

export type ActualTab = NewTabInput;

/**
 * Reconcile a saved tree with the tabs actually open at startup, matching
 * them up by URL order (tab ids change across browser restarts).
 *
 * Saved nodes with no matching actual tab are dropped, promoting their
 * children (same rule as `removeTab`). Actual tabs with no matching saved
 * node are appended as flat new root tabs, in their actual order.
 */
export function restoreTree(
  savedTree: TreeState,
  actualTabs: ActualTab[],
): TreeState {
  const savedNodesByUrl = new Map<string, TabNode[]>();
  for (const node of flattenDepthFirst(savedTree)) {
    const queue = savedNodesByUrl.get(node.url);
    if (queue === undefined) {
      savedNodesByUrl.set(node.url, [node]);
    } else {
      queue.push(node);
    }
  }

  const savedIdToActualId = new Map<number, number>();
  const unmatchedActualTabs: ActualTab[] = [];

  for (const actualTab of actualTabs) {
    const savedNode = savedNodesByUrl.get(actualTab.url)?.shift();
    if (savedNode === undefined) {
      unmatchedActualTabs.push(actualTab);
    } else {
      savedIdToActualId.set(savedNode.id, actualTab.id);
    }
  }

  let tree = savedTree;
  for (const node of flattenDepthFirst(savedTree)) {
    if (!savedIdToActualId.has(node.id)) {
      tree = removeTab(tree, node.id);
    }
  }

  const actualTabById = new Map(actualTabs.map((tab) => [tab.id, tab]));
  const nodes: Record<number, TabNode> = {};

  for (const node of Object.values(tree.nodes)) {
    const actualId = savedIdToActualId.get(node.id);
    const actualTab =
      actualId === undefined ? undefined : actualTabById.get(actualId);
    if (actualId === undefined || actualTab === undefined) {
      continue;
    }

    nodes[actualId] = {
      ...node,
      id: actualId,
      url: actualTab.url,
      title: actualTab.title,
      favIconUrl: actualTab.favIconUrl,
      pinned: actualTab.pinned,
      loading: actualTab.loading,
      suspended: actualTab.suspended,
      parentId:
        node.parentId === null
          ? null
          : (savedIdToActualId.get(node.parentId) ?? null),
      childIds: node.childIds
        .map((childId) => savedIdToActualId.get(childId))
        .filter((id): id is number => id !== undefined),
    };
  }

  const rootIds = tree.rootIds
    .map((id) => savedIdToActualId.get(id))
    .filter((id): id is number => id !== undefined);

  let result: TreeState = { nodes, rootIds };
  for (const actualTab of unmatchedActualTabs) {
    result = addTab(result, actualTab, null);
  }

  return result;
}
