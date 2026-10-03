import {
  getChildren,
  getDescendantIds,
  getNode,
  getPinnedNodes,
  getUnpinnedRootNodes,
} from "./queries";
import type { TabNode, TreeState } from "./types";

/**
 * The tree in the order it's actually displayed: pinned tabs first (their
 * own section, always rendered above the regular tree — see
 * `PinnedTabList`/`TabTree` in `App.tsx`), then the unpinned tree in
 * depth-first order. `rootIds` itself doesn't guarantee pinned tabs sort
 * before unpinned ones, so this can't just be `flattenDepthFirst`.
 */
function displayOrder(tree: TreeState): TabNode[] {
  const result = getPinnedNodes(tree);
  const visited = new Set<number>(result.map((node) => node.id));

  const visit = (node: TabNode): void => {
    if (visited.has(node.id)) {
      return;
    }
    visited.add(node.id);
    result.push(node);
    for (const child of getChildren(tree, node.id)) {
      visit(child);
    }
  };

  for (const root of getUnpinnedRootNodes(tree)) {
    visit(root);
  }

  return result;
}

function siblingIdsOf(tree: TreeState, node: TabNode): number[] {
  if (node.parentId === null) {
    return [...getPinnedNodes(tree), ...getUnpinnedRootNodes(tree)].map(
      (sibling) => sibling.id,
    );
  }

  return getNode(tree, node.parentId)?.childIds ?? [];
}

/**
 * Picks which tab should become active after `closedId` is closed, based on
 * its position in the tree at the time it was closed.
 *
 * `excludedIds` are other tabs being closed in the same batch (e.g. "Close
 * tree", a multi-selection close, or several tabs closed together outside
 * Tabor) — candidates among them are skipped in favor of the next one.
 *
 * Order of preference:
 * 1. The nearest surviving descendant (depth-first) within the closed tab's
 *    own subtree.
 * 2. Among real siblings (same parent — pinned tabs are always roots, so a
 *    pinned tab and an unpinned root count as siblings too): the nearest
 *    following sibling; failing that, the immediately preceding sibling if
 *    it has no children of its own (i.e. it IS the depth-first
 *    predecessor); failing that, the nearest surviving depth-first
 *    predecessor overall.
 * 3. The nearest surviving ancestor.
 * 4. `undefined` if nothing survives.
 */
export function pickFocusTarget(
  tree: TreeState,
  closedId: number,
  excludedIds: ReadonlySet<number>,
): number | undefined {
  const closed = getNode(tree, closedId);
  if (closed === undefined) {
    return undefined;
  }

  const isSurvivor = (id: number): boolean =>
    id !== closedId && !excludedIds.has(id) && getNode(tree, id) !== undefined;

  for (const id of getDescendantIds(tree, closedId)) {
    if (isSurvivor(id)) {
      return id;
    }
  }

  const order = displayOrder(tree);
  const closedIndex = order.findIndex((node) => node.id === closedId);

  const siblingIds = siblingIdsOf(tree, closed);

  if (siblingIds.length > 1) {
    const index = siblingIds.indexOf(closedId);

    for (
      let siblingIndex = index + 1;
      siblingIndex < siblingIds.length;
      siblingIndex++
    ) {
      const siblingId = siblingIds[siblingIndex];
      if (siblingId !== undefined && isSurvivor(siblingId)) {
        return siblingId;
      }
    }

    const previousId = siblingIds[index - 1];

    if (
      previousId !== undefined &&
      getNode(tree, previousId)?.childIds.length === 0 &&
      isSurvivor(previousId)
    ) {
      return previousId;
    }

    for (
      let predecessorIndex = closedIndex - 1;
      predecessorIndex >= 0;
      predecessorIndex--
    ) {
      const predecessorId = order[predecessorIndex]?.id;
      if (predecessorId !== undefined && isSurvivor(predecessorId)) {
        return predecessorId;
      }
    }
  }

  let ancestorId = closed.parentId;
  while (ancestorId !== null) {
    if (isSurvivor(ancestorId)) {
      return ancestorId;
    }
    ancestorId = getNode(tree, ancestorId)?.parentId ?? null;
  }

  return undefined;
}
