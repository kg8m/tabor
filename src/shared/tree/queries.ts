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

export function flattenDepthFirst(tree: TreeState): TabNode[] {
  const result: TabNode[] = [];

  const visit = (node: TabNode) => {
    result.push(node);
    for (const child of getChildren(tree, node.id)) {
      visit(child);
    }
  };

  for (const root of getRootNodes(tree)) {
    visit(root);
  }

  return result;
}
