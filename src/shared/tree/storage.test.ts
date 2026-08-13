import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTree, saveTree } from "./storage";
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
    get: vi.fn((key: string) =>
      Promise.resolve(store.has(key) ? { [key]: store.get(key) } : {}),
    ),
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
