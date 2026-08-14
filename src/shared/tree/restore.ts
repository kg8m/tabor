import { addTab, removeTab, type NewTabInput } from "./mutations";
import { flattenDepthFirst } from "./queries";
import type { TabNode, TreeState } from "./types";

export type ActualTab = NewTabInput;

/**
 * Tracks which saved nodes `restoreTree` didn't get to match against an
 * actual tab, so a tab Chrome creates moments later (see `matchStraggler`)
 * can still be matched against its real saved parent instead of looking
 * indistinguishable from a genuinely new tab.
 */
export interface RestoreSession {
  leftoverByUrl: Map<string, TabNode[]>;
  matchedIds: Map<number, number>;
}

function buildLeftoverByUrl(savedTree: TreeState): Map<string, TabNode[]> {
  const leftoverByUrl = new Map<string, TabNode[]>();
  for (const node of flattenDepthFirst(savedTree)) {
    const queue = leftoverByUrl.get(node.url);
    if (queue === undefined) {
      leftoverByUrl.set(node.url, [node]);
    } else {
      queue.push(node);
    }
  }
  return leftoverByUrl;
}

export function createRestoreSession(savedTree: TreeState): RestoreSession {
  return {
    leftoverByUrl: buildLeftoverByUrl(savedTree),
    matchedIds: new Map(),
  };
}

/**
 * Matches a tab that shows up after `restoreTree`'s own pass already ran—
 * e.g. because Chrome's session restore hadn't created it yet when
 * `restoreTree` queried for actual tabs (see `waitForTabCreationToSettle`,
 * which only narrows this window rather than closing it)—against whichever
 * saved node with the same URL `restoreTree` didn't get to consume. Resolves
 * that saved node's own parent to whatever actual tab it was itself matched
 * to, which may have happened just now via an earlier call to this same
 * function for that parent.
 *
 * Returns `undefined` if there's no leftover saved node with this URL, i.e.
 * this really does look like a genuinely new tab rather than a straggler.
 */
export function matchStraggler(
  session: RestoreSession,
  actualTab: ActualTab,
): { parentId: number | null } | undefined {
  const savedNode = session.leftoverByUrl.get(actualTab.url)?.shift();
  if (savedNode === undefined) {
    return undefined;
  }

  session.matchedIds.set(savedNode.id, actualTab.id);
  const parentId =
    savedNode.parentId === null
      ? null
      : (session.matchedIds.get(savedNode.parentId) ?? null);
  return { parentId };
}

/**
 * Reconcile a saved tree with the tabs actually open at startup, matching
 * them up by URL order (tab ids change across browser restarts).
 *
 * Saved nodes with no matching actual tab are dropped, promoting their
 * children (same rule as `removeTab`). Actual tabs with no matching saved
 * node are appended as flat new root tabs, in their actual order.
 *
 * Pass a `session` (from `createRestoreSession`) to keep its leftover
 * saved-node queues around afterward, so `matchStraggler` can consult the
 * same state once more of the saved tabs show up.
 */
export function restoreTree(
  savedTree: TreeState,
  actualTabs: ActualTab[],
  session: RestoreSession = createRestoreSession(savedTree),
): TreeState {
  const savedIdToActualId = session.matchedIds;
  const unmatchedActualTabs: ActualTab[] = [];

  for (const actualTab of actualTabs) {
    const savedNode = session.leftoverByUrl.get(actualTab.url)?.shift();
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
