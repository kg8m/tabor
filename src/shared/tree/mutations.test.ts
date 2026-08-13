import { describe, expect, it } from "vitest";
import { addTab, removeTab } from "./mutations";
import { createNode } from "./test-helpers";
import type { TreeState } from "./types";

describe("addTab", () => {
  it("adds a regular tab as the last child of the given parent", () => {
    const parent = createNode({ id: 1, childIds: [2] });
    const existingChild = createNode({ id: 2, parentId: 1 });
    const tree: TreeState = {
      nodes: { 1: parent, 2: existingChild },
      rootIds: [1],
    };

    const result = addTab(
      tree,
      {
        id: 3,
        url: "https://example.com/3",
        title: "Tab 3",
        favIconUrl: undefined,
        pinned: false,
      },
      1,
    );

    expect(result.nodes[1]?.childIds).toEqual([2, 3]);
    expect(result.nodes[3]?.parentId).toBe(1);
    expect(result.rootIds).toEqual([1]);
  });

  it("adds a tab without a parent as a new root, appended at the end", () => {
    const root = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: root }, rootIds: [1] };

    const result = addTab(
      tree,
      {
        id: 2,
        url: "https://example.com/2",
        title: "Tab 2",
        favIconUrl: undefined,
        pinned: false,
      },
      null,
    );

    expect(result.rootIds).toEqual([1, 2]);
    expect(result.nodes[2]?.parentId).toBeNull();
  });

  it("adds a tab as a new root when the given parent id does not exist", () => {
    const tree: TreeState = { nodes: {}, rootIds: [] };

    const result = addTab(
      tree,
      {
        id: 1,
        url: "https://example.com/1",
        title: "Tab 1",
        favIconUrl: undefined,
        pinned: false,
      },
      999,
    );

    expect(result.rootIds).toEqual([1]);
    expect(result.nodes[1]?.parentId).toBeNull();
  });

  it("keeps a pinned tab independent from the tree, ignoring the given parent id", () => {
    const parent = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: parent }, rootIds: [1] };

    const result = addTab(
      tree,
      {
        id: 2,
        url: "https://example.com/2",
        title: "Tab 2",
        favIconUrl: undefined,
        pinned: true,
      },
      1,
    );

    expect(result.nodes[2]?.parentId).toBeNull();
    expect(result.nodes[2]?.pinned).toBe(true);
    expect(result.nodes[1]?.childIds).toEqual([]);
    expect(result.rootIds).toEqual([1, 2]);
  });
});

describe("removeTab", () => {
  it("promotes children to the removed tab's parent, in its place", () => {
    // A
    // ├─ B1
    // ├─ B (removed)
    // │  ├─ C
    // │  └─ D
    // └─ B2
    const a = createNode({ id: 1, childIds: [2, 3, 5] });
    const b1 = createNode({ id: 2, parentId: 1 });
    const b = createNode({ id: 3, parentId: 1, childIds: [4, 6] });
    const c = createNode({ id: 4, parentId: 3 });
    const b2 = createNode({ id: 5, parentId: 1 });
    const d = createNode({ id: 6, parentId: 3 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b1, 3: b, 4: c, 5: b2, 6: d },
      rootIds: [1],
    };

    const result = removeTab(tree, 3);

    expect(result.nodes[1]?.childIds).toEqual([2, 4, 6, 5]);
    expect(result.nodes[4]?.parentId).toBe(1);
    expect(result.nodes[6]?.parentId).toBe(1);
    expect(result.nodes[3]).toBeUndefined();
  });

  it("promotes children to root, in place, when the removed tab had no parent", () => {
    // A
    // B (removed)
    // ├─ C
    // └─ D
    // E
    const a = createNode({ id: 1 });
    const b = createNode({ id: 2, childIds: [3, 4] });
    const c = createNode({ id: 3, parentId: 2 });
    const d = createNode({ id: 4, parentId: 2 });
    const e = createNode({ id: 5 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c, 4: d, 5: e },
      rootIds: [1, 2, 5],
    };

    const result = removeTab(tree, 2);

    expect(result.rootIds).toEqual([1, 3, 4, 5]);
    expect(result.nodes[3]?.parentId).toBeNull();
    expect(result.nodes[4]?.parentId).toBeNull();
  });

  it("only reparents direct children, leaving deeper descendants untouched", () => {
    // A
    // └─ B (removed)
    //    └─ C
    //       └─ D
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1, childIds: [3] });
    const c = createNode({ id: 3, parentId: 2, childIds: [4] });
    const d = createNode({ id: 4, parentId: 3 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c, 4: d },
      rootIds: [1],
    };

    const result = removeTab(tree, 2);

    expect(result.nodes[1]?.childIds).toEqual([3]);
    expect(result.nodes[3]?.parentId).toBe(1);
    expect(result.nodes[4]?.parentId).toBe(3);
  });

  it("simply removes a tab that has no children", () => {
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const tree: TreeState = { nodes: { 1: a, 2: b }, rootIds: [1] };

    const result = removeTab(tree, 2);

    expect(result.nodes[1]?.childIds).toEqual([]);
    expect(result.nodes[2]).toBeUndefined();
  });

  it("returns the tree unchanged when the given id doesn't exist", () => {
    const a = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = removeTab(tree, 999);

    expect(result).toEqual(tree);
  });
});
