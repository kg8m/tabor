import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNode } from "../shared/tree/test-helpers";
import type { TreeState } from "../shared/tree/types";
import {
  registerPendingTreeMove,
  noteTreeMoveAttached,
} from "./pending-tree-move";
import { deleteWindow, setTree } from "./store";

const TARGET_WINDOW_ID = 2;

// A (parent) -> B, C (children, B before C)
const A = createNode({ id: 1, childIds: [2, 3] });
const B = createNode({ id: 2, parentId: 1 });
const C = createNode({ id: 3, parentId: 1 });
const SOURCE_TREE: TreeState = { nodes: { 1: A, 2: B, 3: C }, rootIds: [1] };

// A chain instead of siblings, so moving a subset that excludes the
// topmost node still exercises reparenting among the rest: A -> B -> C.
const CHAIN_A = createNode({ id: 1, childIds: [2] });
const CHAIN_B = createNode({ id: 2, parentId: 1, childIds: [3] });
const CHAIN_C = createNode({ id: 3, parentId: 2 });
const CHAIN_TREE: TreeState = {
  nodes: { 1: CHAIN_A, 2: CHAIN_B, 3: CHAIN_C },
  rootIds: [1],
};

// How the destination tree looks once `handleTabAttached`'s own `addTab`
// call has landed each moved tab as an independent root, before any
// reparenting.
function flattenedDestinationTree(ids: number[]): TreeState {
  const nodes: TreeState["nodes"] = {};
  for (const id of ids) {
    nodes[id] = createNode({ id });
  }
  return { nodes, rootIds: [...ids] };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  deleteWindow(TARGET_WINDOW_ID);
  vi.useRealTimers();
});

describe("noteTreeMoveAttached", () => {
  it("returns undefined until every registered tab has attached", () => {
    registerPendingTreeMove(SOURCE_TREE, [1, 2, 3]);
    setTree(TARGET_WINDOW_ID, flattenedDestinationTree([1, 2, 3]));

    expect(noteTreeMoveAttached(1, TARGET_WINDOW_ID)).toBeUndefined();
    expect(noteTreeMoveAttached(2, TARGET_WINDOW_ID)).toBeUndefined();
  });

  it("reconstructs the original parent/child structure once the whole batch has landed", () => {
    registerPendingTreeMove(SOURCE_TREE, [1, 2, 3]);
    setTree(TARGET_WINDOW_ID, flattenedDestinationTree([1, 2, 3]));

    noteTreeMoveAttached(1, TARGET_WINDOW_ID);
    noteTreeMoveAttached(2, TARGET_WINDOW_ID);
    const result = noteTreeMoveAttached(3, TARGET_WINDOW_ID);

    expect(result?.rootIds).toEqual([1]);
    expect(result?.nodes[1]?.childIds).toEqual([2, 3]);
    expect(result?.nodes[2]?.parentId).toBe(1);
    expect(result?.nodes[3]?.parentId).toBe(1);
  });

  it("drops relationships to a parent that isn't part of the move, promoting it to a root", () => {
    // Only B and C move (A -> B -> C); A stays behind, so B becomes a root
    // while C stays B's child.
    registerPendingTreeMove(CHAIN_TREE, [2, 3]);
    setTree(TARGET_WINDOW_ID, flattenedDestinationTree([2, 3]));

    noteTreeMoveAttached(2, TARGET_WINDOW_ID);
    const result = noteTreeMoveAttached(3, TARGET_WINDOW_ID);

    expect(result?.rootIds).toEqual([2]);
    expect(result?.nodes[2]?.childIds).toEqual([3]);
    expect(result?.nodes[3]?.parentId).toBe(2);
  });

  it("ignores an attach for a tab that isn't part of any pending batch", () => {
    registerPendingTreeMove(SOURCE_TREE, [2, 3]);
    setTree(TARGET_WINDOW_ID, flattenedDestinationTree([2, 3]));

    expect(noteTreeMoveAttached(1, TARGET_WINDOW_ID)).toBeUndefined();
  });

  it("abandons the batch once the safety timeout elapses", () => {
    registerPendingTreeMove(SOURCE_TREE, [2, 3]);
    setTree(TARGET_WINDOW_ID, flattenedDestinationTree([2, 3]));

    noteTreeMoveAttached(2, TARGET_WINDOW_ID);
    vi.runAllTimers();

    expect(noteTreeMoveAttached(3, TARGET_WINDOW_ID)).toBeUndefined();
  });

  it("replaces an earlier still-pending batch when a new one is registered", () => {
    registerPendingTreeMove(CHAIN_TREE, [1, 2, 3]);
    registerPendingTreeMove(CHAIN_TREE, [2, 3]);
    setTree(TARGET_WINDOW_ID, flattenedDestinationTree([2, 3]));

    noteTreeMoveAttached(2, TARGET_WINDOW_ID);
    const result = noteTreeMoveAttached(3, TARGET_WINDOW_ID);

    expect(result?.rootIds).toEqual([2]);
  });
});
