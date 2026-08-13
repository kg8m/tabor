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
