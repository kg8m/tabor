import type { TabNode, TreeState } from "./types";

export function getNode(tree: TreeState, id: number): TabNode | undefined {
  return tree.nodes[id];
}

export function getChildren(tree: TreeState, id: number): TabNode[] {
  const node = getNode(tree, id);
  if (node === undefined) {
    return [];
  }

  return node.childIds
    .map((childId) => getNode(tree, childId))
    .filter((child): child is TabNode => child !== undefined);
}

export function getRootNodes(tree: TreeState): TabNode[] {
  return tree.rootIds
    .map((id) => getNode(tree, id))
    .filter((node): node is TabNode => node !== undefined);
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
