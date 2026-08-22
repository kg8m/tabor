import { describe, expect, it } from "vitest";
import { pickFocusTarget } from "./focus-target";
import { createNode } from "./test-helpers";
import type { TreeState } from "./types";

describe("pickFocusTarget", () => {
  it("focuses the first child when the closed tab has children", () => {
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const tree: TreeState = { nodes: { 1: a, 2: b }, rootIds: [1] };

    expect(pickFocusTarget(tree, 1, new Set())).toBe(2);
  });

  it("falls back to the closed tab's literal depth-first predecessor when its preceding sibling has descendants and there's no following sibling", () => {
    // A            (root)
    //   B           (child of A)
    // C  <- closed  (root, after A)
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c },
      rootIds: [1, 3],
    };

    expect(pickFocusTarget(tree, 3, new Set())).toBe(2);
  });

  it("prefers the following sibling over the preceding sibling's descendant", () => {
    // A            (root)
    //   B           (child of A)
    // C  <- closed  (root, after A)
    // D            (root, after C)
    const a = createNode({ id: 1, childIds: [2] });
    const b = createNode({ id: 2, parentId: 1 });
    const c = createNode({ id: 3 });
    const d = createNode({ id: 4 });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c, 4: d },
      rootIds: [1, 3, 4],
    };

    expect(pickFocusTarget(tree, 3, new Set())).toBe(4);
  });

  it("prefers the following sibling even when the preceding sibling has no descendants", () => {
    const a = createNode({ id: 1 });
    const c = createNode({ id: 2 });
    const d = createNode({ id: 3 });
    const tree: TreeState = {
      nodes: { 1: a, 2: c, 3: d },
      rootIds: [1, 2, 3],
    };

    expect(pickFocusTarget(tree, 2, new Set())).toBe(3);
  });

  it("falls back to the preceding sibling when it has no descendants and there's no following sibling", () => {
    const a = createNode({ id: 1 });
    const c = createNode({ id: 2 });
    const tree: TreeState = {
      nodes: { 1: a, 2: c },
      rootIds: [1, 2],
    };

    expect(pickFocusTarget(tree, 2, new Set())).toBe(1);
  });

  it("focuses the next sibling when the closed tab is the first among siblings", () => {
    const parent = createNode({ id: 1, childIds: [2, 3] });
    const first = createNode({ id: 2, parentId: 1 });
    const second = createNode({ id: 3, parentId: 1 });
    const tree: TreeState = {
      nodes: { 1: parent, 2: first, 3: second },
      rootIds: [1],
    };

    expect(pickFocusTarget(tree, 2, new Set())).toBe(3);
  });

  it("focuses the parent when the closed tab has no siblings", () => {
    const parent = createNode({ id: 1, childIds: [2] });
    const onlyChild = createNode({ id: 2, parentId: 1 });
    const tree: TreeState = {
      nodes: { 1: parent, 2: onlyChild },
      rootIds: [1],
    };

    expect(pickFocusTarget(tree, 2, new Set())).toBe(1);
  });

  it("returns undefined when the closed tab is the only tab", () => {
    const only = createNode({ id: 1 });
    const tree: TreeState = { nodes: { 1: only }, rootIds: [1] };

    expect(pickFocusTarget(tree, 1, new Set())).toBeUndefined();
  });

  it("skips a child excluded by a simultaneous close (e.g. Close tree) and falls through to siblings", () => {
    const parent = createNode({ id: 1, childIds: [2] });
    const child = createNode({ id: 2, parentId: 1 });
    const next = createNode({ id: 3 });
    const tree: TreeState = {
      nodes: { 1: parent, 2: child, 3: next },
      rootIds: [1, 3],
    };

    expect(pickFocusTarget(tree, 1, new Set([2]))).toBe(3);
  });

  it("skips an excluded preceding sibling and prefers the next surviving sibling", () => {
    const a = createNode({ id: 1 });
    const c = createNode({ id: 2 });
    const d = createNode({ id: 3 });
    const tree: TreeState = {
      nodes: { 1: a, 2: c, 3: d },
      rootIds: [1, 2, 3],
    };

    expect(pickFocusTarget(tree, 2, new Set([1]))).toBe(3);
  });

  it("walks up to the nearest surviving ancestor when the parent is also excluded", () => {
    const grandparent = createNode({ id: 1, childIds: [2] });
    const parent = createNode({ id: 2, parentId: 1, childIds: [3] });
    const child = createNode({ id: 3, parentId: 2 });
    const tree: TreeState = {
      nodes: { 1: grandparent, 2: parent, 3: child },
      rootIds: [1],
    };

    expect(pickFocusTarget(tree, 3, new Set([2]))).toBe(1);
  });

  it("treats a pinned tab as a real sibling of an unpinned root", () => {
    const pinned = createNode({ id: 1, pinned: true });
    const closed = createNode({ id: 2, pinned: false });
    const tree: TreeState = {
      nodes: { 1: pinned, 2: closed },
      rootIds: [1, 2],
    };

    expect(pickFocusTarget(tree, 2, new Set())).toBe(1);
  });

  it("focuses the immediately preceding pinned sibling even when another pinned tab precedes it", () => {
    const a = createNode({ id: 1, pinned: true });
    const b = createNode({ id: 2, pinned: true });
    const c = createNode({ id: 3, pinned: false });
    const tree: TreeState = {
      nodes: { 1: a, 2: b, 3: c },
      rootIds: [1, 2, 3],
    };

    expect(pickFocusTarget(tree, 3, new Set())).toBe(2);
  });

  it("sorts pinned tabs before unpinned ones for adjacency, regardless of their relative order in rootIds", () => {
    // Pinned tabs are always displayed above the regular tree (their own
    // section), but `rootIds` doesn't guarantee they actually sort first —
    // here the closed tab is literally the first entry in `rootIds`, with
    // both pinned tabs coming right after it. With no following sibling to
    // prefer, its preceding sibling by display order is the pinned tab b,
    // not nothing (which raw `rootIds` order would suggest).
    const closed = createNode({ id: 1, pinned: false });
    const a = createNode({ id: 2, pinned: true });
    const b = createNode({ id: 3, pinned: true });
    const tree: TreeState = {
      nodes: { 1: closed, 2: a, 3: b },
      rootIds: [1, 2, 3],
    };

    expect(pickFocusTarget(tree, 1, new Set())).toBe(3);
  });

  it("prefers the following sibling over a childless preceding pinned sibling", () => {
    const pinned = createNode({ id: 1, pinned: true });
    const closed = createNode({ id: 2, pinned: false });
    const next = createNode({ id: 3, pinned: false });
    const tree: TreeState = {
      nodes: { 1: pinned, 2: closed, 3: next },
      rootIds: [1, 2, 3],
    };

    expect(pickFocusTarget(tree, 2, new Set())).toBe(3);
  });
});
