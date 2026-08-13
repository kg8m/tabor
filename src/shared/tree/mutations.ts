import type { TabNode, TreeState } from "./types";

export interface NewTabInput {
  id: number;
  url: string;
  title: string;
  favIconUrl: string | undefined;
  pinned: boolean;
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
  const parent =
    parentId === null || input.pinned ? undefined : tree.nodes[parentId];

  const node: TabNode = {
    id: input.id,
    url: input.url,
    title: input.title,
    favIconUrl: input.favIconUrl,
    parentId: parent?.id ?? null,
    childIds: [],
    pinned: input.pinned,
    suspended: false,
    loading: false,
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
