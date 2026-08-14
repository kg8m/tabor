import type { DropPosition } from "./drop";
import { flattenDepthFirst } from "./queries";
import type { TabNode, TreeState } from "./types";

export interface NewTabInput {
  id: number;
  url: string;
  title: string;
  favIconUrl: string | undefined;
  pinned: boolean;
  loading: boolean;
  suspended: boolean;
}

/**
 * Add a newly opened tab to the tree.
 *
 * `parentId` is the tab that was current when the new tab was opened
 * (regardless of whether it was opened via a link or via something like
 * `Ctrl+T`). Pinned tabs are always added as independent root nodes.
 */
export function addTab(
  tree: TreeState,
  input: NewTabInput,
  parentId: number | null,
): TreeState {
  // Already in the tree—e.g. a startup reconciliation (see
  // `restoreTree`/`initializeAllWindows`) picked it up before the
  // `onCreated` handler that's adding it got a chance to run. Adding it
  // again would duplicate its id in `rootIds`/`childIds`.
  if (tree.nodes[input.id] !== undefined) {
    return tree;
  }

  // A tab can't be its own parent (e.g. the caller mistakenly resolved the
  // "current tab" to the tab that's only just now being added). Treating it
  // as its own parent would make the node its own child once attached below.
  const resolvedParentId = parentId === input.id ? null : parentId;

  const parent =
    resolvedParentId === null || input.pinned
      ? undefined
      : tree.nodes[resolvedParentId];

  const node: TabNode = {
    id: input.id,
    url: input.url,
    title: input.title,
    favIconUrl: input.favIconUrl,
    parentId: parent?.id ?? null,
    childIds: [],
    pinned: input.pinned,
    suspended: input.suspended,
    loading: input.loading,
    collapsed: false,
  };

  const nodes: Record<number, TabNode> = { ...tree.nodes, [node.id]: node };

  if (parent === undefined) {
    return { nodes, rootIds: [...tree.rootIds, node.id] };
  }

  nodes[parent.id] = { ...parent, childIds: [...parent.childIds, node.id] };

  return { nodes, rootIds: tree.rootIds };
}

/**
 * Remove a tab from the tree.
 *
 * Its children are promoted to its own parent, in place of the removed tab,
 * keeping their original sibling order. If the removed tab had no parent,
 * its children become root nodes at the same position.
 */
export function removeTab(tree: TreeState, id: number): TreeState {
  const target = tree.nodes[id];
  if (target === undefined) {
    return tree;
  }

  const nodes = { ...tree.nodes };
  delete nodes[id];

  for (const childId of target.childIds) {
    const child = nodes[childId];
    if (child !== undefined) {
      nodes[childId] = { ...child, parentId: target.parentId };
    }
  }

  const replaceWithChildren = (ids: number[]): number[] =>
    ids.flatMap((currentId) =>
      currentId === id ? target.childIds : [currentId],
    );

  if (target.parentId === null) {
    return { nodes, rootIds: replaceWithChildren(tree.rootIds) };
  }

  const parent = nodes[target.parentId];
  if (parent === undefined) {
    // The parent id doesn't resolve to a node (data inconsistency); fall
    // back to promoting the children to root, appended at the end.
    return { nodes, rootIds: [...tree.rootIds, ...target.childIds] };
  }

  nodes[parent.id] = {
    ...parent,
    childIds: replaceWithChildren(parent.childIds),
  };

  return { nodes, rootIds: tree.rootIds };
}

export type TabUpdate = Partial<
  Pick<
    TabNode,
    | "url"
    | "title"
    | "favIconUrl"
    | "loading"
    | "suspended"
    | "pinned"
    | "collapsed"
  >
>;

/**
 * Update a tab's own properties, leaving its position in the tree untouched.
 */
export function updateTab(
  tree: TreeState,
  id: number,
  update: TabUpdate,
): TreeState {
  const node = tree.nodes[id];
  if (node === undefined) {
    return tree;
  }

  return {
    ...tree,
    nodes: { ...tree.nodes, [id]: { ...node, ...update } },
  };
}

/**
 * Remove a tab from its current parent's `childIds` (or `rootIds`).
 */
function detach(tree: TreeState, id: number): TreeState {
  const node = tree.nodes[id];
  if (node === undefined) {
    return tree;
  }

  if (node.parentId === null) {
    return { ...tree, rootIds: tree.rootIds.filter((rootId) => rootId !== id) };
  }

  const parent = tree.nodes[node.parentId];
  if (parent === undefined) {
    return tree;
  }

  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [parent.id]: {
        ...parent,
        childIds: parent.childIds.filter((childId) => childId !== id),
      },
    },
  };
}

/**
 * Insert a tab as a child of `parentId` (or as a root, if `null`) at `index`.
 */
function attachAt(
  tree: TreeState,
  id: number,
  parentId: number | null,
  index: number,
): TreeState {
  const node = tree.nodes[id];
  if (node === undefined) {
    return tree;
  }

  const nodes = { ...tree.nodes, [id]: { ...node, parentId } };

  if (parentId === null) {
    const rootIds = [...tree.rootIds];
    rootIds.splice(index, 0, id);
    return { nodes, rootIds };
  }

  const parent = nodes[parentId];
  if (parent === undefined) {
    return { nodes, rootIds: [...tree.rootIds, id] };
  }

  const childIds = [...parent.childIds];
  childIds.splice(index, 0, id);
  nodes[parent.id] = { ...parent, childIds };

  return { nodes, rootIds: tree.rootIds };
}

/**
 * Whether `id` is `ancestorId` itself or one of its descendants, walking up
 * `parentId` links. Bails out safely (returns `false`) if it revisits a node,
 * rather than looping forever on an already-corrupt, cyclic tree.
 */
function isSelfOrDescendant(
  tree: TreeState,
  ancestorId: number,
  id: number,
): boolean {
  const visited = new Set<number>();
  let current: number | undefined = id;

  while (current !== undefined) {
    if (current === ancestorId) {
      return true;
    }
    if (visited.has(current)) {
      return false;
    }
    visited.add(current);
    current = tree.nodes[current]?.parentId ?? undefined;
  }

  return false;
}

/**
 * Reconcile the tree with a tab having moved in the native tab bar.
 *
 * The native tab bar has no concept of a tree, so the only information a
 * move gives us is the tab's new position among the other (non-pinned)
 * tabs, `newOrder`. We derive the new parent from whichever tab now
 * precedes it: if that tab already has children, the moved tab becomes its
 * first child (matching depth-first order); otherwise it becomes that tab's
 * next sibling. Moving to the front makes it a new first root.
 */
export function reorderFromNativeMove(
  tree: TreeState,
  movedId: number,
  newOrder: number[],
): TreeState {
  if (tree.nodes[movedId] === undefined) {
    return tree;
  }

  const index = newOrder.indexOf(movedId);
  const previousId = newOrder[index - 1];

  // A move that would place movedId right after its own descendant would
  // make movedId a descendant of its own descendant—a cycle. This isn't a
  // real drag target (the descendant would have had to move first), so
  // leave the tree untouched rather than corrupting it.
  if (
    previousId !== undefined &&
    isSelfOrDescendant(tree, movedId, previousId)
  ) {
    return tree;
  }

  const detached = detach(tree, movedId);

  if (previousId === undefined) {
    return attachAt(detached, movedId, null, 0);
  }

  const previous = detached.nodes[previousId];
  if (previous === undefined) {
    return attachAt(detached, movedId, null, detached.rootIds.length);
  }

  if (previous.childIds.length > 0) {
    return attachAt(detached, movedId, previousId, 0);
  }

  if (previous.parentId === null) {
    const previousIndex = detached.rootIds.indexOf(previousId);
    return attachAt(detached, movedId, null, previousIndex + 1);
  }

  const grandParent = detached.nodes[previous.parentId];
  if (grandParent === undefined) {
    return attachAt(detached, movedId, null, detached.rootIds.length);
  }

  const previousIndexInParent = grandParent.childIds.indexOf(previousId);
  return attachAt(
    detached,
    movedId,
    previous.parentId,
    previousIndexInParent + 1,
  );
}

export interface DropTarget {
  targetId: number;
  position: DropPosition;
}

/**
 * Move `id` to a new position in the tree, per a drag-and-drop drop resolved
 * via `resolveDropPosition`: `before`/`after` reorder it as a sibling of
 * `target.targetId`, `child` makes it target's last child.
 *
 * Refuses the move (returning the tree unchanged) if the target doesn't
 * exist, is the dragged node itself, or is one of its own descendants—the
 * latter would create a cycle.
 */
export function moveNode(
  tree: TreeState,
  id: number,
  target: DropTarget,
): TreeState {
  if (
    tree.nodes[id] === undefined ||
    tree.nodes[target.targetId] === undefined
  ) {
    return tree;
  }
  if (id === target.targetId || isSelfOrDescendant(tree, id, target.targetId)) {
    return tree;
  }

  const detached = detach(tree, id);

  if (target.position === "child") {
    const parent = detached.nodes[target.targetId];
    return attachAt(
      detached,
      id,
      target.targetId,
      parent?.childIds.length ?? 0,
    );
  }

  const relativeTo = detached.nodes[target.targetId]!;
  const siblingIds =
    relativeTo.parentId === null
      ? detached.rootIds
      : (detached.nodes[relativeTo.parentId]?.childIds ?? []);
  const targetIndex = siblingIds.indexOf(target.targetId);
  const index = target.position === "before" ? targetIndex : targetIndex + 1;

  return attachAt(detached, id, relativeTo.parentId, index);
}

/**
 * Move several nodes together to a new position, as a single drag-and-drop
 * of a multi-selection, preserving their current relative order.
 *
 * A node that's a descendant of another node also in `ids` is skipped:
 * moving the ancestor already carries it along, and moving it separately
 * too would try to place it in two locations at once.
 */
export function moveNodes(
  tree: TreeState,
  ids: number[],
  target: DropTarget,
): TreeState {
  const topLevelIds = new Set(
    ids.filter((id) =>
      ids.every(
        (other) => other === id || !isSelfOrDescendant(tree, other, id),
      ),
    ),
  );
  const orderedIds = flattenDepthFirst(tree)
    .map((node) => node.id)
    .filter((id) => topLevelIds.has(id));

  let result = tree;
  let currentTarget = target;

  for (const id of orderedIds) {
    const moved = moveNode(result, id, currentTarget);
    // Anchor the next node right after this one, so the group ends up
    // contiguous in `orderedIds` order—but only if this move actually took
    // effect; otherwise the next node should still aim at the original
    // target rather than a node that never moved.
    if (moved !== result) {
      currentTarget = { targetId: id, position: "after" };
    }
    result = moved;
  }

  return result;
}
