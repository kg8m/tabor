import { describe, expect, it } from "vitest";
import { createNode } from "../shared/tree/test-helpers";
import type { TreeState } from "../shared/tree/types";
import {
  clearDeletedWindow,
  deleteWindow,
  getTree,
  getTreeId,
  isDeletedWindow,
  setTree,
  setTreeId,
} from "./store";

describe("deleteWindow / isDeletedWindow / clearDeletedWindow", () => {
  it("marks a window id as deleted", () => {
    const windowId = 101;

    deleteWindow(windowId);

    expect(isDeletedWindow(windowId)).toBe(true);
  });

  it("clears the in-memory tree for the deleted window", () => {
    const windowId = 102;
    const tree: TreeState = {
      nodes: { 1: createNode({ id: 1 }) },
      rootIds: [1],
    };
    setTree(windowId, tree);

    deleteWindow(windowId);

    expect(getTree(windowId)).toEqual({ nodes: {}, rootIds: [] });
  });

  it("forgets which tree the deleted window held", () => {
    const windowId = 107;
    setTreeId(windowId, "tree-107");

    deleteWindow(windowId);

    expect(getTreeId(windowId)).toBeUndefined();
  });

  it("clearDeletedWindow un-marks a window id previously passed to deleteWindow", () => {
    const windowId = 103;
    deleteWindow(windowId);

    clearDeletedWindow(windowId);

    expect(isDeletedWindow(windowId)).toBe(false);
  });

  it("doesn't mark other window ids as deleted", () => {
    const deletedWindowId = 104;
    const otherWindowId = 105;

    deleteWindow(deletedWindowId);

    expect(isDeletedWindow(otherWindowId)).toBe(false);
  });

  it("reports a window id that was never deleted as not deleted", () => {
    expect(isDeletedWindow(106)).toBe(false);
  });
});
