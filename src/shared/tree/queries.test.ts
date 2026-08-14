import { describe, expect, it } from "vitest";
import {
  flattenDepthFirst,
  getChildren,
  getNativeOrder,
  getNode,
  getRootNodes,
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

describe("getRootNodes", () => {
  it("returns the top-level nodes in order", () => {
    const tree = createSampleTree();
    expect(getRootNodes(tree).map((node) => node.id)).toEqual([1, 5]);
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
});

describe("getNativeOrder", () => {
  it("returns the tab ids in depth-first order", () => {
    const tree = createSampleTree();
    expect(getNativeOrder(tree)).toEqual([1, 2, 3, 4, 5]);
  });
});
