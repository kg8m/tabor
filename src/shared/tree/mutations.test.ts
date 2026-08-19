import { describe, expect, it } from "vitest";
import {
  addTab,
  moveNode,
  moveNodes,
  removeTab,
  reorderFromNativeMove,
  replaceTabId,
  updateTab,
} from "./mutations";
import { getNativeOrder } from "./queries";
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
        loading: false,
        suspended: false,
        audible: false,
      },
      1,
    );

    expect(result.nodes[1]?.childIds).toEqual([2, 3]);
    expect(result.nodes[3]?.parentId).toBe(1);
    expect(result.rootIds).toEqual([1]);
  });

  it("carries over the given loading and suspended state", () => {
    const tree: TreeState = { nodes: {}, rootIds: [] };

    const result = addTab(
      tree,
      {
        id: 1,
        url: "https://example.com/1",
        title: "Tab 1",
        favIconUrl: undefined,
        pinned: false,
        loading: true,
        suspended: true,
        audible: true,
      },
      null,
    );

    expect(result.nodes[1]?.loading).toBe(true);
    expect(result.nodes[1]?.suspended).toBe(true);
    expect(result.nodes[1]?.audible).toBe(true);
  });

  it("adds as a root instead of becoming its own parent when parentId equals its own id", () => {
    const tree: TreeState = { nodes: {}, rootIds: [] };

    const result = addTab(
      tree,
      {
        id: 1,
        url: "https://example.com/1",
        title: "Tab 1",
        favIconUrl: undefined,
        pinned: false,
        loading: false,
        suspended: false,
        audible: false,
      },
      1,
    );

    expect(result.rootIds).toEqual([1]);
    expect(result.nodes[1]?.parentId).toBeNull();
    expect(result.nodes[1]?.childIds).toEqual([]);
  });

  it("does nothing when a tab with the given id is already in the tree", () => {
    // e.g. a startup reconciliation already picked up this tab before the
    // onCreated handler for it got a chance to run.
    const parent = createNode({ id: 1, childIds: [2] });
    const existing = createNode({ id: 2, parentId: 1 });
    const tree: TreeState = {
      nodes: { 1: parent, 2: existing },
      rootIds: [1],
    };

    const result = addTab(
      tree,
      {
        id: 2,
        url: "https://example.com/2",
        title: "Tab 2",
        favIconUrl: undefined,
        pinned: false,
        loading: false,
        suspended: false,
        audible: false,
      },
      1,
    );

    expect(result).toEqual(tree);
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
        loading: false,
        suspended: false,
        audible: false,
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
        loading: false,
        suspended: false,
        audible: false,
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
        loading: false,
        suspended: false,
        audible: false,
      },
      1,
    );

    expect(result.nodes[2]?.parentId).toBeNull();
    expect(result.nodes[2]?.pinned).toBe(true);
    expect(result.nodes[1]?.childIds).toEqual([]);
    expect(result.rootIds).toEqual([1, 2]);
  });

  it("adds a new tab as the first root, right after the pinned tabs, when the given parent is pinned", () => {
    // Opening a link from a pinned tab shouldn't make the new tab a child of
    // it—pinned tabs have no parent/child relationships in either direction.
    // Natively, Chrome places such a tab right after the pinned region
    // (i.e. as the first non-pinned tab), not at the very end like a tab
    // opened with no parent at all (e.g. Ctrl+T)—so match that here too.
    const pinnedParent = createNode({ id: 1, pinned: true });
    const existingRoot = createNode({ id: 2 });
    const tree: TreeState = {
      nodes: { 1: pinnedParent, 2: existingRoot },
      rootIds: [1, 2],
    };

    const result = addTab(
      tree,
      {
        id: 3,
        url: "https://example.com/3",
        title: "Tab 3",
        favIconUrl: undefined,
        pinned: false,
        loading: false,
        suspended: false,
        audible: false,
      },
      1,
    );

    expect(result.nodes[3]?.parentId).toBeNull();
    expect(result.nodes[1]?.childIds).toEqual([]);
    expect(result.rootIds).toEqual([3, 1, 2]);
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

describe("updateTab", () => {
  it("merges the given properties into the tab, leaving others untouched", () => {
    const a = createNode({ id: 1, title: "Old title", loading: true });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = updateTab(tree, 1, { title: "New title", loading: false });

    expect(result.nodes[1]?.title).toBe("New title");
    expect(result.nodes[1]?.loading).toBe(false);
    expect(result.nodes[1]?.url).toBe(a.url);
  });

  it("updates audible", () => {
    const a = createNode({ id: 1, audible: false });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = updateTab(tree, 1, { audible: true });

    expect(result.nodes[1]?.audible).toBe(true);
  });

  it("leaves the tab's position in the tree untouched", () => {
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const tree: TreeState = { nodes: { 1: a, 2: b }, rootIds: [1] };

    const result = updateTab(tree, 2, { title: "New title" });

    expect(result.nodes[1]?.childIds).toEqual([2]);
    expect(result.nodes[2]?.parentId).toBe(1);
    expect(result.rootIds).toEqual([1]);
  });

  it("returns the tree unchanged when the given id doesn't exist", () => {
    const a = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = updateTab(tree, 999, { title: "New title" });

    expect(result).toEqual(tree);
  });

  it("can toggle collapsed", () => {
    const a = createNode({ id: 1, collapsed: false });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = updateTab(tree, 1, { collapsed: true });

    expect(result.nodes[1]?.collapsed).toBe(true);
  });

  it("can set and clear the note", () => {
    const a = createNode({ id: 1, note: null });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const withNote = updateTab(tree, 1, { note: "Remember this" });
    expect(withNote.nodes[1]?.note).toBe("Remember this");

    const cleared = updateTab(withNote, 1, { note: null });
    expect(cleared.nodes[1]?.note).toBeNull();
  });
});

describe("replaceTabId", () => {
  it("renames a root node, keeping its position and children", () => {
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1, 3] };

    const result = replaceTabId(tree, 1, 100);

    expect(result.nodes[1]).toBeUndefined();
    expect(result.nodes[100]?.id).toBe(100);
    expect(result.nodes[100]?.childIds).toEqual([2]);
    expect(result.nodes[2]?.parentId).toBe(100);
    expect(result.rootIds).toEqual([100, 3]);
  });

  it("renames a child node, keeping its position among its siblings", () => {
    const a = createNode({ id: 1, childIds: [2, 3] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3, parentId: 1 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1] };

    const result = replaceTabId(tree, 2, 100);

    expect(result.nodes[2]).toBeUndefined();
    expect(result.nodes[100]?.parentId).toBe(1);
    expect(result.nodes[1]?.childIds).toEqual([100, 3]);
  });

  it("applies the given field updates to the renamed node", () => {
    const a = createNode({ id: 1, title: "Old title", suspended: false });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = replaceTabId(tree, 1, 100, {
      title: "New title",
      suspended: true,
    });

    expect(result.nodes[100]?.title).toBe("New title");
    expect(result.nodes[100]?.suspended).toBe(true);
  });

  it("returns the tree unchanged when the old id doesn't exist", () => {
    const a = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = replaceTabId(tree, 999, 100);

    expect(result).toEqual(tree);
  });

  it("returns the tree unchanged when the new id is already in use", () => {
    const a = createNode({ id: 1 });
    const b = createNode({ id: 2 });
    const tree: TreeState = { nodes: { 1: a, 2: b }, rootIds: [1, 2] };

    const result = replaceTabId(tree, 1, 2);

    expect(result).toEqual(tree);
  });
});

describe("reorderFromNativeMove", () => {
  it("keeps a tab as its preceding tab's child when it was already its only child", () => {
    // A(B) -> native order [A, B] (unchanged) -> should still be A(B), not
    // two roots. Reprocessing an unmoved-relative-to-its-parent tab (e.g.
    // triggered by a programmatic move elsewhere in the tab strip) must not
    // demote it to a sibling just because detaching it to reorder makes its
    // parent look childless.
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const tree: TreeState = { nodes: { 1: a, 2: b }, rootIds: [1] };

    const result = reorderFromNativeMove(tree, 2, [1, 2]);

    expect(result.nodes[1]?.childIds).toEqual([2]);
    expect(result.nodes[2]?.parentId).toBe(1);
    expect(result.rootIds).toEqual([1]);
  });

  it("moves a tab to become the first child of its new preceding tab", () => {
    // A(B, C, D) -> native order [A, C, B, D] -> A(C, B, D)
    const a = createNode({ id: 1, childIds: [2, 3, 4] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3, parentId: 1 });
    const d = createNode({ id: 4, parentId: 1 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c, 4: d },
      rootIds: [1],
    };

    const result = reorderFromNativeMove(tree, 3, [1, 3, 2, 4]);

    expect(result.nodes[1]?.childIds).toEqual([3, 2, 4]);
    expect(result.nodes[3]?.parentId).toBe(1);
    expect(getNativeOrder(result)).toEqual([1, 3, 2, 4]);
  });

  it("reparents a tab into a different tab's subtree when moved past it", () => {
    // A(B, C), D(E) -> native order [A, B, D, C, E] -> A(B), D(C, E)
    const a = createNode({ id: 1, childIds: [2, 3] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3, parentId: 1 });
    const d = createNode({ id: 4, childIds: [5] });
    const e = createNode({ id: 5, parentId: 4 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c, 4: d, 5: e },
      rootIds: [1, 4],
    };

    const result = reorderFromNativeMove(tree, 3, [1, 2, 4, 3, 5]);

    expect(result.nodes[1]?.childIds).toEqual([2]);
    expect(result.nodes[4]?.childIds).toEqual([3, 5]);
    expect(result.nodes[3]?.parentId).toBe(4);
    expect(getNativeOrder(result)).toEqual([1, 2, 4, 3, 5]);
  });

  it("becomes the next sibling of the preceding tab when that tab has no children", () => {
    // A(B, C), D(E) -> native order [A, B, D, E, C] -> A(B), D(E, C)
    const a = createNode({ id: 1, childIds: [2, 3] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3, parentId: 1 });
    const d = createNode({ id: 4, childIds: [5] });
    const e = createNode({ id: 5, parentId: 4 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c, 4: d, 5: e },
      rootIds: [1, 4],
    };

    const result = reorderFromNativeMove(tree, 3, [1, 2, 4, 5, 3]);

    expect(result.nodes[1]?.childIds).toEqual([2]);
    expect(result.nodes[4]?.childIds).toEqual([5, 3]);
    expect(result.nodes[3]?.parentId).toBe(4);
    expect(getNativeOrder(result)).toEqual([1, 2, 4, 5, 3]);
  });

  it("becomes a new first root when moved to the very front", () => {
    // A(B), D(E) -> native order [C, A, B, D, E] -> C, A(B), D(E)
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3 });
    const d = createNode({ id: 4, childIds: [5] });
    const e = createNode({ id: 5, parentId: 4 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c, 4: d, 5: e },
      rootIds: [1, 3, 4],
    };

    const result = reorderFromNativeMove(tree, 3, [3, 1, 2, 4, 5]);

    expect(result.rootIds).toEqual([3, 1, 4]);
    expect(result.nodes[3]?.parentId).toBeNull();
    expect(getNativeOrder(result)).toEqual([3, 1, 2, 4, 5]);
  });

  it("leaves the tree untouched rather than reparenting a tab under its own descendant", () => {
    // A(B(C)) -> native order [B, C, A] would put A right after its own
    // descendant C, which would make A a descendant of B while B stays a
    // descendant of A. That's a cycle, so this must be a no-op.
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1, childIds: [3] });
    const c = createNode({ id: 3, parentId: 2 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1] };

    const result = reorderFromNativeMove(tree, 1, [2, 3, 1]);

    expect(result).toEqual(tree);
  });

  it("returns the tree unchanged when the given id doesn't exist", () => {
    const a = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = reorderFromNativeMove(tree, 999, [1]);

    expect(result).toEqual(tree);
  });
});

describe("moveNode", () => {
  it("inserts the node as a sibling before the target", () => {
    // A, B, C -> drop A before C -> B, A, C
    const a = createNode({ id: 1 });
    const b = createNode({ id: 2 });
    const c = createNode({ id: 3 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1, 2, 3] };

    const result = moveNode(tree, 1, { targetId: 3, position: "before" });

    expect(result.rootIds).toEqual([2, 1, 3]);
    expect(result.nodes[1]?.parentId).toBeNull();
  });

  it("inserts the node as a sibling after the target", () => {
    // A, B, C -> drop A after B -> B, A, C
    const a = createNode({ id: 1 });
    const b = createNode({ id: 2 });
    const c = createNode({ id: 3 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1, 2, 3] };

    const result = moveNode(tree, 1, { targetId: 2, position: "after" });

    expect(result.rootIds).toEqual([2, 1, 3]);
  });

  it("makes the node the target's last child", () => {
    // A, B(C) -> drop A onto B -> B(C, A)
    const a = createNode({ id: 1 });
    const b = createNode({ id: 2, childIds: [3] });
    const c = createNode({ id: 3, parentId: 2 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1, 2] };

    const result = moveNode(tree, 1, { targetId: 2, position: "child" });

    expect(result.rootIds).toEqual([2]);
    expect(result.nodes[2]?.childIds).toEqual([3, 1]);
    expect(result.nodes[1]?.parentId).toBe(2);
  });

  it("keeps the moved node's own children attached to it", () => {
    // A(B), C -> drop A after C -> C, A(B)
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1, 3] };

    const result = moveNode(tree, 1, { targetId: 3, position: "after" });

    expect(result.rootIds).toEqual([3, 1]);
    expect(result.nodes[1]?.childIds).toEqual([2]);
    expect(result.nodes[2]?.parentId).toBe(1);
  });

  it("leaves the tree untouched when the target is the node's own descendant", () => {
    // A(B(C)) -> dropping A onto its own grandchild C would create a cycle
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1, childIds: [3] });
    const c = createNode({ id: 3, parentId: 2 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1] };

    const result = moveNode(tree, 1, { targetId: 3, position: "child" });

    expect(result).toEqual(tree);
  });

  it("leaves the tree untouched when dropped onto itself", () => {
    const a = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = moveNode(tree, 1, { targetId: 1, position: "after" });

    expect(result).toEqual(tree);
  });

  it("returns the tree unchanged when the given id doesn't exist", () => {
    const a = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = moveNode(tree, 999, { targetId: 1, position: "after" });

    expect(result).toEqual(tree);
  });

  it("returns the tree unchanged when the target doesn't exist", () => {
    const a = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = moveNode(tree, 1, { targetId: 999, position: "after" });

    expect(result).toEqual(tree);
  });
});

describe("moveNodes", () => {
  it("moves several nodes together as children, preserving their tree order", () => {
    // A, B, C, D -> drop {C, A} onto D -> B, D(A, C)
    const a = createNode({ id: 1 });
    const b = createNode({ id: 2 });
    const c = createNode({ id: 3 });
    const d = createNode({ id: 4 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c, 4: d },
      rootIds: [1, 2, 3, 4],
    };

    const result = moveNodes(tree, [3, 1], { targetId: 4, position: "child" });

    expect(result.rootIds).toEqual([2, 4]);
    expect(result.nodes[4]?.childIds).toEqual([1, 3]);
  });

  it("skips a selected node that's a descendant of another selected node", () => {
    // A(B), C -> drop {A, B} onto C -> C(A(B))
    // B is dropped from the move list since moving A already carries it
    // along; moving it separately too would try to place it twice.
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1, 3] };

    const result = moveNodes(tree, [1, 2], {
      targetId: 3,
      position: "child",
    });

    expect(result.rootIds).toEqual([3]);
    expect(result.nodes[3]?.childIds).toEqual([1]);
    expect(result.nodes[1]?.childIds).toEqual([2]);
    expect(result.nodes[2]?.parentId).toBe(1);
  });

  it("leaves the tree untouched for a move that would create a cycle, and still moves the rest", () => {
    // A(B), C -> drop {A, C} onto B -> A can't move onto its own descendant
    // B, so only C moves: A(B), B(C)
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3 });
    const tree: TreeState = { nodes: { 1: a, 2: b, 3: c }, rootIds: [1, 3] };

    const result = moveNodes(tree, [1, 3], {
      targetId: 2,
      position: "child",
    });

    expect(result.rootIds).toEqual([1]);
    expect(result.nodes[1]?.childIds).toEqual([2]);
    expect(result.nodes[2]?.childIds).toEqual([3]);
  });

  it("orders the moved nodes by their tree position, not the order given", () => {
    // A, B, C, D -> drop {A, C} (given as [C, A]) after D -> B, D, A, C
    const a = createNode({ id: 1 });
    const b = createNode({ id: 2 });
    const c = createNode({ id: 3 });
    const d = createNode({ id: 4 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c, 4: d },
      rootIds: [1, 2, 3, 4],
    };

    const result = moveNodes(tree, [3, 1], { targetId: 4, position: "after" });

    expect(result.rootIds).toEqual([2, 4, 1, 3]);
  });
});
