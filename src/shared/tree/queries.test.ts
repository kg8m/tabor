import { describe, expect, it } from "vitest";
import {
  flattenDepthFirst,
  getChildren,
  getNativeOrder,
  getNode,
  getPinnedNodes,
  getRootNodes,
  getUnpinnedRootNodes,
  getVisibleOrder,
  isSelfOrDescendant,
} from "./queries";
import { createNode } from "./test-helpers";
import type { TreeState } from "./types";

// A
// ├─ B
// │  └─ C
// └─ D
// E
function createSampleTree(): TreeState {
  const a = createNode({ id: 1, childIds: [2, 4] });
  const b = createNode({ id: 2, parentId: 1, childIds: [3] });
  const c = createNode({ id: 3, parentId: 2 });
  const d = createNode({ id: 4, parentId: 1 });
  const e = createNode({ id: 5 });

  return {
    nodes: { 1: a, 2: b, 3: c, 4: d, 5: e },
    rootIds: [1, 5],
  };
}

describe("getNode", () => {
  it("returns the node with the given id", () => {
    const tree = createSampleTree();
    expect(getNode(tree, 3)?.id).toBe(3);
  });

  it("returns undefined for an unknown id", () => {
    const tree = createSampleTree();
    expect(getNode(tree, 999)).toBeUndefined();
  });
});

describe("getChildren", () => {
  it("returns the children of a node in order", () => {
    const tree = createSampleTree();
    expect(getChildren(tree, 1).map((node) => node.id)).toEqual([2, 4]);
  });

  it("returns an empty array for a node without children", () => {
    const tree = createSampleTree();
    expect(getChildren(tree, 3)).toEqual([]);
  });

  it("returns an empty array for an unknown id", () => {
    const tree = createSampleTree();
    expect(getChildren(tree, 999)).toEqual([]);
  });
});

describe("isSelfOrDescendant", () => {
  it("returns true when id is the ancestorId itself", () => {
    const tree = createSampleTree();
    expect(isSelfOrDescendant(tree, 2, 2)).toBe(true);
  });

  it("returns true for a direct child", () => {
    const tree = createSampleTree();
    expect(isSelfOrDescendant(tree, 2, 3)).toBe(true);
  });

  it("returns true for a deeper descendant", () => {
    const tree = createSampleTree();
    expect(isSelfOrDescendant(tree, 1, 3)).toBe(true);
  });

  it("returns false for a node that isn't a descendant", () => {
    const tree = createSampleTree();
    expect(isSelfOrDescendant(tree, 2, 4)).toBe(false);
    expect(isSelfOrDescendant(tree, 3, 1)).toBe(false);
    expect(isSelfOrDescendant(tree, 1, 5)).toBe(false);
  });

  it("doesn't loop forever if the data is corrupted into a cycle", () => {
    // A -> B -> A (each is the other's parent and child).
    const a = createNode({ id: 1, parentId: 2, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1, childIds: [1] });
    const tree: TreeState = { nodes: { 1: a, 2: b }, rootIds: [] };

    expect(isSelfOrDescendant(tree, 3, 1)).toBe(false);
  });
});

describe("getRootNodes", () => {
  it("returns the top-level nodes in order", () => {
    const tree = createSampleTree();
    expect(getRootNodes(tree).map((node) => node.id)).toEqual([1, 5]);
  });
});

describe("getPinnedNodes", () => {
  it("returns only the pinned root nodes, in order", () => {
    const a = createNode({ id: 1, pinned: true });
    const b = createNode({ id: 2 });
    const c = createNode({ id: 3, pinned: true });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1, 2, 3] };

    expect(getPinnedNodes(tree).map((node) => node.id)).toEqual([1, 3]);
  });

  it("returns an empty array when no tab is pinned", () => {
    const tree = createSampleTree();
    expect(getPinnedNodes(tree)).toEqual([]);
  });
});

describe("getUnpinnedRootNodes", () => {
  it("returns only the non-pinned root nodes, in order", () => {
    const a = createNode({ id: 1, pinned: true });
    const b = createNode({ id: 2 });
    const c = createNode({ id: 3, pinned: true });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1, 2, 3] };

    expect(getUnpinnedRootNodes(tree).map((node) => node.id)).toEqual([2]);
  });
});

describe("flattenDepthFirst", () => {
  it("flattens the tree in depth-first order", () => {
    const tree = createSampleTree();
    expect(flattenDepthFirst(tree).map((node) => node.id)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("returns an empty array for an empty tree", () => {
    const tree: TreeState = { nodes: {}, rootIds: [] };
    expect(flattenDepthFirst(tree)).toEqual([]);
  });

  it("doesn't loop forever if the data is corrupted into a cycle", () => {
    // A -> B -> A (each is the other's parent and child).
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1, childIds: [1] });
    const tree: TreeState = { nodes: { 1: a, 2: b }, rootIds: [1] };

    expect(flattenDepthFirst(tree).map((node) => node.id)).toEqual([1, 2]);
  });

  it("still descends into a collapsed node's children by default", () => {
    const tree = createSampleTree();
    const collapsed = {
      ...tree,
      nodes: { ...tree.nodes, 2: { ...tree.nodes[2]!, collapsed: true } },
    };

    expect(flattenDepthFirst(collapsed).map((node) => node.id)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("skips a collapsed node's children when respectCollapsed is set", () => {
    const tree = createSampleTree();
    const collapsed = {
      ...tree,
      nodes: { ...tree.nodes, 2: { ...tree.nodes[2]!, collapsed: true } },
    };

    expect(
      flattenDepthFirst(collapsed, { respectCollapsed: true }).map(
        (node) => node.id,
      ),
    ).toEqual([1, 2, 4, 5]);
  });
});

describe("getNativeOrder", () => {
  it("returns the tab ids in depth-first order", () => {
    const tree = createSampleTree();
    expect(getNativeOrder(tree)).toEqual([1, 2, 3, 4, 5]);
  });

  it("includes a collapsed node's children", () => {
    const tree = createSampleTree();
    const collapsed = {
      ...tree,
      nodes: { ...tree.nodes, 2: { ...tree.nodes[2]!, collapsed: true } },
    };

    expect(getNativeOrder(collapsed)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("getVisibleOrder", () => {
  it("returns the same order as flattenDepthFirst when nothing is collapsed", () => {
    const tree = createSampleTree();
    expect(getVisibleOrder(tree).map((node) => node.id)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("skips a collapsed node's children", () => {
    const tree = createSampleTree();
    const collapsed = {
      ...tree,
      nodes: { ...tree.nodes, 2: { ...tree.nodes[2]!, collapsed: true } },
    };

    expect(getVisibleOrder(collapsed).map((node) => node.id)).toEqual([
      1, 2, 4, 5,
    ]);
  });
});
