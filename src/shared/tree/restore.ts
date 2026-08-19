import {
  addTab,
  reorderFromNativeMove,
  removeTab,
  type NewTabInput,
} from "./mutations";
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
      // A discarded tab's favicon isn't always populated yet by the time
      // `chrome.tabs.query` returns it right after startup—Chrome hasn't
      // finished loading it from session data—so falling back to the saved
      // one (the same page, so the same icon) beats losing it until the tab
      // is actually reloaded.
      favIconUrl: actualTab.favIconUrl ?? node.favIconUrl,
      pinned: actualTab.pinned,
      loading: actualTab.loading,
      suspended: actualTab.suspended,
      audible: actualTab.audible,
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

  // The native order actual tabs are already in (`chrome.tabs.query`
  // returns them in tab-strip order), restricted to non-pinned tabs—the
  // same convention `reorderFromNativeMove`'s callers use elsewhere (see
  // `handleTabMoved`). Used below to place each unmatched tab where it
  // actually sits in the tab strip, rather than always at the very end.
  const nonPinnedNativeOrder = actualTabs
    .filter((tab) => !tab.pinned)
    .map((tab) => tab.id);

  let result: TreeState = { nodes, rootIds };
  for (const actualTab of unmatchedActualTabs) {
    result = addTab(result, actualTab, null);

    // `addTab` always appends as the last root, which is wrong whenever an
    // unmatched tab (e.g. a browser-injected page like Chrome's "What's
    // New" tab after an update) actually sits among tabs that did match
    // the saved tree. Reuse `reorderFromNativeMove`'s placement logic,
    // driven by this same tab's real position in `actualTabs`, to correct
    // that. Every tab that precedes it in `nonPinnedNativeOrder` is
    // already in `result.nodes` by this point—either matched above, or
    // added and repositioned by an earlier iteration of this same loop.
    if (!actualTab.pinned) {
      result = reorderFromNativeMove(
        result,
        actualTab.id,
        nonPinnedNativeOrder,
      );
    }
  }

  return result;
}
