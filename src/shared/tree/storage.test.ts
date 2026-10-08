import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingRemoval,
  loadAllTrees,
  loadPendingRemovals,
  loadTree,
  loadTreeIdForWindow,
  loadTreeIdsByWindowId,
  markPendingRemoval,
  migrateLegacyTrees,
  planLegacyTreeMigration,
  removeTree,
  removeTreeIdForWindow,
  saveTree,
  saveTreeIdForWindow,
} from "./storage";
import { createNode } from "./test-helpers";
import type { TreeState } from "./types";

function createStorageAreaMock() {
  const store = new Map<string, unknown>();

  return {
    set: vi.fn((items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
      return Promise.resolve();
    }),
    // No `get(null)`: nothing should read every stored value anymore (see
    // `loadValuesBySuffix`), so a regression back to it fails here.
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

// vitest’s `expect.any()` matcher types as `any`; wrapping it once here
// keeps that unsafe assignment contained to this one spot instead of
// disabling the lint rule at every place below that asserts a saved
// timestamp without caring about its exact value.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const ANY_NUMBER: number = expect.any(Number);

const TREE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TREE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function singleTabTree(id: number): TreeState {
  return { nodes: { [id]: createNode({ id }) }, rootIds: [id] };
}

function stubChromeStorage() {
  const local = createStorageAreaMock();
  vi.stubGlobal("chrome", {
    storage: { local, session: createStorageAreaMock() },
  });
  return local;
}

beforeEach(() => {
  stubChromeStorage();
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

    await saveTree(TREE_A, tree);

    expect(await loadTree(TREE_A)).toEqual({
      tree,
      savedAt: ANY_NUMBER,
    });
  });

  it("returns undefined when nothing has been saved under the tree id", async () => {
    expect(await loadTree(TREE_A)).toBeUndefined();
  });

  it("keeps different trees independent", async () => {
    const treeA = singleTabTree(1);
    const treeB = singleTabTree(2);

    await saveTree(TREE_A, treeA);
    await saveTree(TREE_B, treeB);

    expect(await loadTree(TREE_A)).toEqual({
      tree: treeA,
      savedAt: ANY_NUMBER,
    });
    expect(await loadTree(TREE_B)).toEqual({
      tree: treeB,
      savedAt: ANY_NUMBER,
    });
  });

  it("reads a tree saved before `savedAt` existed as the oldest possible save", async () => {
    const tree = singleTabTree(1);
    // Simulates a pre-existing storage entry from before this field was
    // introduced: a bare `TreeState`, not the `{ tree, savedAt }` wrapper.
    await chrome.storage.local.set({ [`tabor:windowTree:${TREE_A}`]: tree });

    expect(await loadTree(TREE_A)).toEqual({ tree, savedAt: 0 });
  });

  it("marks an incognito window’s tree as such", async () => {
    const tree = singleTabTree(1);

    await saveTree(TREE_A, tree, { incognito: true });

    expect(await loadTree(TREE_A)).toEqual({
      tree,
      savedAt: ANY_NUMBER,
      incognito: true,
    });
  });

  it("leaves a debug log entry behind for a normal window’s empty tree", async () => {
    await saveTree(TREE_A, { nodes: {}, rootIds: [] });

    const keys = await chrome.storage.local.getKeys();
    expect(keys.filter((key) => key.startsWith("tabor:debug:"))).toHaveLength(
      1,
    );
  });

  it("doesn’t leave a debug log entry behind for an incognito window’s empty tree", async () => {
    await saveTree(TREE_A, { nodes: {}, rootIds: [] }, { incognito: true });

    const keys = await chrome.storage.local.getKeys();
    expect(keys.filter((key) => key.startsWith("tabor:debug:"))).toEqual([]);
  });

  it("still saves an incognito window’s empty tree itself", async () => {
    await saveTree(TREE_A, { nodes: {}, rootIds: [] }, { incognito: true });

    expect(await loadTree(TREE_A)).toEqual({
      tree: { nodes: {}, rootIds: [] },
      savedAt: ANY_NUMBER,
      incognito: true,
    });
  });

  it("leaves the incognito mark out altogether for a normal window’s tree", async () => {
    await saveTree(TREE_A, singleTabTree(1), { incognito: false });
    await saveTree(TREE_B, singleTabTree(2));

    expect(await loadTree(TREE_A)).not.toHaveProperty("incognito");
    expect(await loadTree(TREE_B)).not.toHaveProperty("incognito");
  });

  it("records a non-normal window’s type", async () => {
    const tree = singleTabTree(1);

    await saveTree(TREE_A, tree, { windowType: "popup" });

    expect(await loadTree(TREE_A)).toEqual({
      tree,
      savedAt: ANY_NUMBER,
      windowType: "popup",
    });
  });

  it("leaves the window type out altogether for a normal window’s tree", async () => {
    await saveTree(TREE_A, singleTabTree(1), { windowType: "normal" });
    await saveTree(TREE_B, singleTabTree(2));

    expect(await loadTree(TREE_A)).not.toHaveProperty("windowType");
    expect(await loadTree(TREE_B)).not.toHaveProperty("windowType");
  });
});

describe("removeTree", () => {
  it("removes only the given saved tree", async () => {
    const treeB = singleTabTree(2);
    await saveTree(TREE_A, singleTabTree(1));
    await saveTree(TREE_B, treeB);

    await removeTree(TREE_A);

    expect(await loadTree(TREE_A)).toBeUndefined();
    expect(await loadTree(TREE_B)).toEqual({
      tree: treeB,
      savedAt: ANY_NUMBER,
    });
  });
});

describe("loadAllTrees", () => {
  it("returns every saved tree, keyed by tree id", async () => {
    const treeA = singleTabTree(1);
    const treeB = singleTabTree(2);
    await saveTree(TREE_A, treeA);
    await saveTree(TREE_B, treeB);

    expect(await loadAllTrees()).toEqual(
      new Map([
        [TREE_A, { tree: treeA, savedAt: ANY_NUMBER }],
        [TREE_B, { tree: treeB, savedAt: ANY_NUMBER }],
      ]),
    );
  });

  it("keeps each tree’s incognito mark", async () => {
    await saveTree(TREE_A, singleTabTree(1), { incognito: true });
    await saveTree(TREE_B, singleTabTree(2));

    const trees = await loadAllTrees();

    expect(trees.get(TREE_A)?.incognito).toBe(true);
    expect(trees.get(TREE_B)).not.toHaveProperty("incognito");
  });

  it("keeps each tree’s window type", async () => {
    await saveTree(TREE_A, singleTabTree(1), { windowType: "popup" });
    await saveTree(TREE_B, singleTabTree(2));

    const trees = await loadAllTrees();

    expect(trees.get(TREE_A)?.windowType).toBe("popup");
    expect(trees.get(TREE_B)).not.toHaveProperty("windowType");
  });

  it("returns an empty map when nothing has been saved", async () => {
    expect(await loadAllTrees()).toEqual(new Map());
  });

  it("doesn’t mistake a pending-removal mark for a saved tree", async () => {
    const tree = singleTabTree(1);
    await saveTree(TREE_A, tree);
    await markPendingRemoval(TREE_B);

    expect(await loadAllTrees()).toEqual(
      new Map([[TREE_A, { tree, savedAt: ANY_NUMBER }]]),
    );
  });

  it("skips a key whose tree id isn’t well-formed, and legacy window-id keys", async () => {
    const tree = singleTabTree(1);
    await saveTree(TREE_A, tree);
    await chrome.storage.local.set({
      "tabor:windowTree:abc": tree,
      "tabor:tree:1": tree,
    });

    expect(await loadAllTrees()).toEqual(
      new Map([[TREE_A, { tree, savedAt: ANY_NUMBER }]]),
    );
  });
});

describe("pending removal marks", () => {
  it("round-trips a mark through markPendingRemoval / loadPendingRemovals, recording when it was marked", async () => {
    await markPendingRemoval(TREE_A);

    expect(await loadPendingRemovals()).toEqual(
      new Map([[TREE_A, ANY_NUMBER]]),
    );
  });

  it("skips a mark whose tree id isn’t well-formed", async () => {
    await markPendingRemoval(TREE_A);
    await chrome.storage.local.set({
      "tabor:pendingTreeRemoval:abc": 0,
      "tabor:pendingTreeRemoval:1": 0,
    });

    expect(await loadPendingRemovals()).toEqual(
      new Map([[TREE_A, ANY_NUMBER]]),
    );
  });

  it("doesn’t push a mark’s timestamp forward on a later repeated miss", async () => {
    await markPendingRemoval(TREE_A);
    const firstMarks = await loadPendingRemovals();

    await markPendingRemoval(TREE_A);

    const secondMarks = await loadPendingRemovals();
    expect(secondMarks.get(TREE_A)).toBe(firstMarks.get(TREE_A));
  });

  it("clearPendingRemoval removes only the given tree’s mark", async () => {
    await markPendingRemoval(TREE_A);
    await markPendingRemoval(TREE_B);

    await clearPendingRemoval(TREE_A);

    const marks = await loadPendingRemovals();
    expect(marks.has(TREE_A)).toBe(false);
    expect(marks.has(TREE_B)).toBe(true);
  });

  it("removeTree also clears the tree’s pending-removal mark", async () => {
    await saveTree(TREE_A, singleTabTree(1));
    await markPendingRemoval(TREE_A);

    await removeTree(TREE_A);

    expect(await loadPendingRemovals()).toEqual(new Map());
  });
});

describe("tree ids per window", () => {
  it("round-trips which tree a window holds", async () => {
    await saveTreeIdForWindow(1, TREE_A);

    expect(await loadTreeIdForWindow(1)).toBe(TREE_A);
    expect(await loadTreeIdForWindow(2)).toBeUndefined();
  });

  it("lists every window’s tree id, and forgets a removed one", async () => {
    await saveTreeIdForWindow(1, TREE_A);
    await saveTreeIdForWindow(2, TREE_B);

    await removeTreeIdForWindow(1);

    expect(await loadTreeIdsByWindowId()).toEqual(new Map([[2, TREE_B]]));
  });
});

describe("planLegacyTreeMigration", () => {
  it("moves each legacy tree to a fresh tree id, carrying its pending-removal mark along", () => {
    const ids = [TREE_A, TREE_B];
    const plan = planLegacyTreeMigration(
      new Map([
        [1, "tree-1"],
        [2, "tree-2"],
      ]),
      new Map([[2, 12_345]]),
      () => ids.shift() ?? "unexpected",
    );

    expect(plan.toSet).toEqual({
      [`tabor:windowTree:${TREE_A}`]: "tree-1",
      [`tabor:windowTree:${TREE_B}`]: "tree-2",
      [`tabor:pendingTreeRemoval:${TREE_B}`]: 12_345,
    });
    expect(plan.treeIdsByLegacyWindowId).toEqual(
      new Map([
        [1, TREE_A],
        [2, TREE_B],
      ]),
    );
    expect(new Set(plan.toRemove)).toEqual(
      new Set(["tabor:tree:1", "tabor:tree:2", "tabor:pendingTreeRemoval:2"]),
    );
  });

  it("removes a legacy mark whose tree is already gone, without moving it anywhere", () => {
    const plan = planLegacyTreeMigration(new Map(), new Map([[3, 12_345]]));

    expect(plan.toSet).toEqual({});
    expect(plan.toRemove).toEqual(["tabor:pendingTreeRemoval:3"]);
  });
});

describe("migrateLegacyTrees", () => {
  it("moves legacy trees and marks over, recording the tree of a window that’s still open", async () => {
    const tree1 = singleTabTree(1);
    const tree2 = singleTabTree(2);
    await chrome.storage.local.set({
      "tabor:tree:1": { tree: tree1, savedAt: 100 },
      "tabor:tree:2": { tree: tree2, savedAt: 200 },
      "tabor:pendingTreeRemoval:2": 12_345,
      "tabor:pendingTreeRemoval:3": 67_890,
    });

    await migrateLegacyTrees([1]);

    const keys = await chrome.storage.local.getKeys();
    expect(keys.filter((key) => key.startsWith("tabor:tree:"))).toEqual([]);

    const trees = await loadAllTrees();
    expect(trees.values().toArray()).toEqual(
      expect.arrayContaining([
        { tree: tree1, savedAt: 100 },
        { tree: tree2, savedAt: 200 },
      ]),
    );
    const treeIdSavedAt = (savedAt: number) =>
      trees.entries().find(([, stored]) => stored.savedAt === savedAt)?.[0];

    expect(await loadPendingRemovals()).toEqual(
      new Map([[treeIdSavedAt(200), 12_345]]),
    );
    expect(await loadTreeIdsByWindowId()).toEqual(
      new Map([[1, treeIdSavedAt(100)]]),
    );
  });

  it("does nothing once there’s nothing left to migrate", async () => {
    const local = stubChromeStorage();
    await saveTree(TREE_A, singleTabTree(1));

    await migrateLegacyTrees([1]);

    expect(local.set).toHaveBeenCalledTimes(1);
    expect(local.remove).not.toHaveBeenCalled();
  });
});
