import { describe, expect, it } from "vitest";
import { addTab } from "./mutations";
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
