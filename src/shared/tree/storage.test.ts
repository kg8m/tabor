import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingRemoval,
  loadAllTrees,
  loadPendingRemovals,
  loadTree,
  markPendingRemoval,
  removeTree,
  saveTree,
} from "./storage";
import { createNode } from "./test-helpers";
import type { TreeState } from "./types";

function createStorageLocalMock() {
  const store = new Map<string, unknown>();

  return {
    set: vi.fn((items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
      return Promise.resolve();
    }),
    get: vi.fn((keys: string | null) => {
      if (keys === null) {
        return Promise.resolve(Object.fromEntries(store));
      }
      return Promise.resolve(
        store.has(keys) ? { [keys]: store.get(keys) } : {},
      );
    }),
    remove: vi.fn((keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) {
        store.delete(key);
      }
      return Promise.resolve();
    }),
  };
}

beforeEach(() => {
  vi.stubGlobal("chrome", { storage: { local: createStorageLocalMock() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveTree / loadTree", () => {
  it("round-trips a tree through storage", async () => {
    const tree: TreeState = {
      nodes: {
        1: createNode({ id: 1, childIds: [2] }),
        2: createNode({ id: 2, parentId: 1 }),
      },
      rootIds: [1],
    };

    await saveTree(1, tree);

    expect(await loadTree(1)).toEqual(tree);
  });

  it("returns undefined when nothing has been saved for the window", async () => {
    expect(await loadTree(999)).toBeUndefined();
  });

  it("keeps trees for different windows independent", async () => {
    const treeA: TreeState = {
      nodes: { 1: createNode({ id: 1 }) },
      rootIds: [1],
    };
    const treeB: TreeState = {
      nodes: { 2: createNode({ id: 2 }) },
      rootIds: [2],
    };

    await saveTree(1, treeA);
    await saveTree(2, treeB);

    expect(await loadTree(1)).toEqual(treeA);
    expect(await loadTree(2)).toEqual(treeB);
  });
});

describe("removeTree", () => {
  it("removes only the given window's saved tree", async () => {
    const treeA: TreeState = {
      nodes: { 1: createNode({ id: 1 }) },
      rootIds: [1],
    };
    const treeB: TreeState = {
      nodes: { 2: createNode({ id: 2 }) },
      rootIds: [2],
    };
    await saveTree(1, treeA);
    await saveTree(2, treeB);

    await removeTree(1);

    expect(await loadTree(1)).toBeUndefined();
    expect(await loadTree(2)).toEqual(treeB);
  });
});

describe("loadAllTrees", () => {
  it("returns every saved tree, keyed by window id", async () => {
    const treeA: TreeState = {
      nodes: { 1: createNode({ id: 1 }) },
      rootIds: [1],
    };
    const treeB: TreeState = {
      nodes: { 2: createNode({ id: 2 }) },
      rootIds: [2],
    };
    await saveTree(1, treeA);
    await saveTree(2, treeB);

    expect(await loadAllTrees()).toEqual({ 1: treeA, 2: treeB });
  });

  it("returns an empty object when nothing has been saved", async () => {
    expect(await loadAllTrees()).toEqual({});
  });

  it("doesn't mistake a pending-removal mark for a saved tree", async () => {
    const tree: TreeState = {
      nodes: { 1: createNode({ id: 1 }) },
      rootIds: [1],
    };
    await saveTree(1, tree);
    await markPendingRemoval(2);

    expect(await loadAllTrees()).toEqual({ 1: tree });
  });
});

describe("pending removal marks", () => {
  it("round-trips a mark through markPendingRemoval / loadPendingRemovals, recording when it was marked", async () => {
    await markPendingRemoval(1);

    const marks = await loadPendingRemovals();
    expect(marks.size).toBe(1);
    expect(marks.get(1)).toEqual(expect.any(Number));
  });

  it("doesn't push a mark's timestamp forward on a later repeated miss", async () => {
    await markPendingRemoval(1);
    const firstMarks = await loadPendingRemovals();
    const firstMarkedAt = firstMarks.get(1);

    await markPendingRemoval(1);

    const secondMarks = await loadPendingRemovals();
    expect(secondMarks.get(1)).toBe(firstMarkedAt);
  });

  it("clearPendingRemoval removes only the given window's mark", async () => {
    await markPendingRemoval(1);
    await markPendingRemoval(2);

    await clearPendingRemoval(1);

    const marks = await loadPendingRemovals();
    expect(marks.has(1)).toBe(false);
    expect(marks.has(2)).toBe(true);
  });

  it("removeTree also clears the window's pending-removal mark", async () => {
    const tree: TreeState = {
      nodes: { 1: createNode({ id: 1 }) },
      rootIds: [1],
    };
    await saveTree(1, tree);
    await markPendingRemoval(1);

    await removeTree(1);

    expect(await loadPendingRemovals()).toEqual(new Map());
  });
});
