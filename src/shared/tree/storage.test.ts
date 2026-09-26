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
    // No `get(null)`: nothing should read every stored value anymore (see
    // `loadValuesByNumericSuffix`), so a regression back to it fails here.
    get: vi.fn((keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      return Promise.resolve(
        Object.fromEntries(
          keyList
            .filter((key) => store.has(key))
            .map((key) => [key, store.get(key)]),
        ),
      );
    }),
    getKeys: vi.fn(() => Promise.resolve(store.keys().toArray())),
    remove: vi.fn((keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) {
        store.delete(key);
      }
      return Promise.resolve();
    }),
  };
}

// vitest's `expect.any()` matcher types as `any`; wrapping it once here
// keeps that unsafe assignment contained to this one spot instead of
// disabling the lint rule at every place below that asserts a saved
// timestamp without caring about its exact value.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const ANY_NUMBER: number = expect.any(Number);

beforeEach(() => {
  vi.stubGlobal("chrome", { storage: { local: createStorageLocalMock() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveTree / loadTree", () => {
  it("round-trips a tree through storage, stamped with when it was saved", async () => {
    const tree: TreeState = {
      nodes: {
        1: createNode({ id: 1, childIds: [2] }),
        2: createNode({ id: 2, parentId: 1 }),
      },
      rootIds: [1],
    };

    await saveTree(1, tree);

    expect(await loadTree(1)).toEqual({
      tree,
      savedAt: ANY_NUMBER,
    });
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

    expect(await loadTree(1)).toEqual({
      tree: treeA,
      savedAt: ANY_NUMBER,
    });
    expect(await loadTree(2)).toEqual({
      tree: treeB,
      savedAt: ANY_NUMBER,
    });
  });

  it("reads a tree saved before `savedAt` existed as the oldest possible save", async () => {
    const tree: TreeState = {
      nodes: { 1: createNode({ id: 1 }) },
      rootIds: [1],
    };
    // Simulates a pre-existing storage entry from before this field was
    // introduced: a bare `TreeState`, not the `{ tree, savedAt }` wrapper.
    await chrome.storage.local.set({ "tabor:tree:1": tree });

    expect(await loadTree(1)).toEqual({ tree, savedAt: 0 });
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
    expect(await loadTree(2)).toEqual({
      tree: treeB,
      savedAt: ANY_NUMBER,
    });
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

    expect(await loadAllTrees()).toEqual({
      1: { tree: treeA, savedAt: ANY_NUMBER },
      2: { tree: treeB, savedAt: ANY_NUMBER },
    });
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

    expect(await loadAllTrees()).toEqual({
      1: { tree, savedAt: ANY_NUMBER },
    });
  });

  it("skips a key whose window id isn't numeric", async () => {
    const tree: TreeState = {
      nodes: { 1: createNode({ id: 1 }) },
      rootIds: [1],
    };
    await saveTree(1, tree);
    await chrome.storage.local.set({ "tabor:tree:abc": tree });

    expect(await loadAllTrees()).toEqual({
      1: { tree, savedAt: ANY_NUMBER },
    });
  });
});

describe("pending removal marks", () => {
  it("skips a mark whose window id isn't numeric", async () => {
    await markPendingRemoval(1);
    await chrome.storage.local.set({ "tabor:pendingTreeRemoval:abc": 0 });

    expect(await loadPendingRemovals()).toEqual(new Map([[1, ANY_NUMBER]]));
  });

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
