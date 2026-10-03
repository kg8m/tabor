import type { TabNode, TreeState } from "./types";

/**
 * Look up a node by id, or `undefined` if it's not (or no longer) in the
 * tree.
 */
export function getNode(tree: TreeState, id: number): TabNode | undefined {
  return tree.nodes[id];
}

/**
 * A node's direct children, in sibling order.
 */
export function getChildren(tree: TreeState, id: number): TabNode[] {
  const node = getNode(tree, id);
  if (node === undefined) {
    return [];
  }

  return node.childIds
    .map((childId) => getNode(tree, childId))
    .filter((child): child is TabNode => child !== undefined);
}

/**
 * All descendants of a node (children, grandchildren, etc.), not including
 * the node itself. Guards against revisiting a node the same way
 * `flattenDepthFirst` does.
 */
export function getDescendantIds(tree: TreeState, id: number): number[] {
  const result: number[] = [];
  const visited = new Set<number>();

  const visit = (nodeId: number): void => {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);

    for (const child of getChildren(tree, nodeId)) {
      result.push(child.id);
      visit(child.id);
    }
  };

  visit(id);
  return result;
}

/**
 * Whether `id` is `ancestorId` itself or one of its descendants, walking up
 * `parentId` links. Bails out safely (returns `false`) if it revisits a node,
 * rather than looping forever on an already-corrupt, cyclic tree.
 */
export function isSelfOrDescendant(
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
 * Every root-level node (pinned and unpinned), in display order.
 */
export function getRootNodes(tree: TreeState): TabNode[] {
  return tree.rootIds
    .map((id) => getNode(tree, id))
    .filter((node): node is TabNode => node !== undefined);
}

/**
 * Pinned tabs, which are always roots with no children (see `addTab`) and
 * are displayed in their own section, separate from the tree.
 */
export function getPinnedNodes(tree: TreeState): TabNode[] {
  return getRootNodes(tree).filter((node) => node.pinned);
}

/**
 * The root nodes that make up the regular tree, i.e. excluding pinned tabs.
 */
export function getUnpinnedRootNodes(tree: TreeState): TabNode[] {
  return getRootNodes(tree).filter((node) => !node.pinned);
}

interface FlattenDepthFirstOptions {
  /**
   * Stop descending into a collapsed node's children, matching what's
   * actually visible in the side panel.
   */
  respectCollapsed?: boolean;
}

/**
 * Flatten the tree in depth-first order.
 *
 * Guards against revisiting a node: a well-formed tree can't contain one,
 * but if the data were ever corrupted into a cycle, this stops that from
 * turning into infinite recursion instead of just silently truncating the
 * cyclic branch.
 */
export function flattenDepthFirst(
  tree: TreeState,
  { respectCollapsed = false }: FlattenDepthFirstOptions = {},
): TabNode[] {
  const result: TabNode[] = [];
  const visited = new Set<number>();

  const visit = (node: TabNode) => {
    if (visited.has(node.id)) {
      return;
    }
    visited.add(node.id);

    result.push(node);
    if (respectCollapsed && node.collapsed) {
      return;
    }
    for (const child of getChildren(tree, node.id)) {
      visit(child);
    }
  };

  for (const root of getRootNodes(tree)) {
    visit(root);
  }

  return result;
}

/**
 * The tab id order the native tab bar should be kept in sync with,
 * derived from the tree's depth-first order.
 */
export function getNativeOrder(tree: TreeState): number[] {
  return flattenDepthFirst(tree).map((node) => node.id);
}

/**
 * The depth-first order of nodes actually visible in the side panel, i.e.
 * skipping the descendants of collapsed nodes. Used to resolve a Shift-click
 * range selection to the tabs shown between the two clicked nodes.
 */
export function getVisibleOrder(tree: TreeState): TabNode[] {
  return flattenDepthFirst(tree, { respectCollapsed: true });
}

/**
 * Whether the tree has any parent/child relationship at all, rather than
 * being just a flat list of root-level tabs (every node is its own root,
 * i.e. `rootIds.length === Object.keys(nodes).length`).
 */
export function hasHierarchy(tree: TreeState): boolean {
  return Object.keys(tree.nodes).length > tree.rootIds.length;
}

/**
 * Whether the tree holds anything only Tabor knows about, rather than just
 * what the native tab bar shows too: a parent/child relationship (see
 * `hasHierarchy`; which nodes are collapsed only matters along with one) or
 * a note. Used to decide whether a closed window's tree is worth keeping
 * (see `windows.onRemoved`), and likewise a saved tree that went unmatched
 * (see `initializeAllWindows`): without either, reopening the same tabs
 * later would rebuild an identical tree regardless.
 */
export function hasTaborSpecificInfo(tree: TreeState): boolean {
  return (
    hasHierarchy(tree) ||
    Object.values(tree.nodes).some((node) => node.note !== null)
  );
}
