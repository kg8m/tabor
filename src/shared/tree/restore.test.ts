import { describe, expect, it } from "vitest";
import {
  createRestoreSession,
  matchStraggler,
  restoreTree,
  type ActualTab,
} from "./restore";
import { createNode } from "./test-helpers";
import type { TreeState } from "./types";

function actualTab(overrides: Partial<ActualTab> & { id: number }): ActualTab {
  return {
    url: `https://example.com/${overrides.id}`,
    title: `Tab ${overrides.id}`,
    favIconUrl: undefined,
    pinned: false,
    loading: false,
    suspended: false,
    ...overrides,
  };
}

describe("restoreTree", () => {
  it("re-links the whole tree when every url matches", () => {
    // Saved: A(id=100) -> B(id=200)
    const a = createNode({ id: 100, url: "https://a.com", childIds: [200] });
    const b = createNode({ id: 200, url: "https://b.com", parentId: 100 });
    const savedTree: TreeState = { nodes: { 100: a, 200: b }, rootIds: [100] };

    const actualTabs = [
      actualTab({ id: 1, url: "https://a.com" }),
      actualTab({ id: 2, url: "https://b.com" }),
    ];

    const result = restoreTree(savedTree, actualTabs);

    expect(result.rootIds).toEqual([1]);
    expect(result.nodes[1]?.childIds).toEqual([2]);
    expect(result.nodes[2]?.parentId).toBe(1);
  });

  it("drops a saved node with no matching tab and promotes its children", () => {
    // Saved: A(id=100) -> [B(id=200), C(id=300) -> D(id=400)]
    // C is gone; D should be promoted to A, after B.
    const a = createNode({
      id: 100,
      url: "https://a.com",
      childIds: [200, 300],
    });
    const b = createNode({ id: 200, url: "https://b.com", parentId: 100 });
    const c = createNode({
      id: 300,
      url: "https://c.com",
      parentId: 100,
      childIds: [400],
    });
    const d = createNode({ id: 400, url: "https://d.com", parentId: 300 });
    const savedTree: TreeState = {
      nodes: { 100: a, 200: b, 300: c, 400: d },
      rootIds: [100],
    };

    const actualTabs = [
      actualTab({ id: 1, url: "https://a.com" }),
      actualTab({ id: 2, url: "https://b.com" }),
      actualTab({ id: 4, url: "https://d.com" }),
    ];

    const result = restoreTree(savedTree, actualTabs);

    expect(result.nodes[1]?.childIds).toEqual([2, 4]);
    expect(result.nodes[4]?.parentId).toBe(1);
    expect(Object.keys(result.nodes)).toHaveLength(3);
  });

  it("appends unmatched actual tabs as flat new roots, in their order", () => {
    const a = createNode({ id: 100, url: "https://a.com" });
    const savedTree: TreeState = { nodes: { 100: a }, rootIds: [100] };

    const actualTabs = [
      actualTab({ id: 1, url: "https://a.com" }),
      actualTab({ id: 2, url: "https://new-1.com" }),
      actualTab({ id: 3, url: "https://new-2.com" }),
    ];

    const result = restoreTree(savedTree, actualTabs);

    expect(result.rootIds).toEqual([1, 2, 3]);
    expect(result.nodes[2]?.parentId).toBeNull();
    expect(result.nodes[3]?.parentId).toBeNull();
  });

  it("keeps collapsed state from the saved tree for matched nodes", () => {
    const a = createNode({ id: 100, url: "https://a.com", collapsed: true });
    const savedTree: TreeState = { nodes: { 100: a }, rootIds: [100] };

    const result = restoreTree(savedTree, [
      actualTab({ id: 1, url: "https://a.com" }),
    ]);

    expect(result.nodes[1]?.collapsed).toBe(true);
  });

  it("reflects the actual tab's loading/suspended state, not the saved one", () => {
    const a = createNode({
      id: 100,
      url: "https://a.com",
      loading: true,
      suspended: false,
    });
    const savedTree: TreeState = { nodes: { 100: a }, rootIds: [100] };

    const result = restoreTree(savedTree, [
      actualTab({
        id: 1,
        url: "https://a.com",
        loading: false,
        suspended: true,
      }),
    ]);

    expect(result.nodes[1]?.loading).toBe(false);
    expect(result.nodes[1]?.suspended).toBe(true);
  });

  it("falls back to the saved favicon when the actual tab has none yet", () => {
    const a = createNode({
      id: 100,
      url: "https://a.com",
      favIconUrl: "https://a.com/favicon.ico",
    });
    const savedTree: TreeState = { nodes: { 100: a }, rootIds: [100] };

    const result = restoreTree(savedTree, [
      actualTab({ id: 1, url: "https://a.com", favIconUrl: undefined }),
    ]);

    expect(result.nodes[1]?.favIconUrl).toBe("https://a.com/favicon.ico");
  });

  it("prefers the actual tab's favicon over the saved one when it has one", () => {
    const a = createNode({
      id: 100,
      url: "https://a.com",
      favIconUrl: "https://a.com/old-favicon.ico",
    });
    const savedTree: TreeState = { nodes: { 100: a }, rootIds: [100] };

    const result = restoreTree(savedTree, [
      actualTab({
        id: 1,
        url: "https://a.com",
        favIconUrl: "https://a.com/new-favicon.ico",
      }),
    ]);

    expect(result.nodes[1]?.favIconUrl).toBe("https://a.com/new-favicon.ico");
  });

  it("matches same-url saved nodes and actual tabs in encounter order", () => {
    // Saved: A(id=100, dup url) -> B(id=200, dup url)
    const a = createNode({
      id: 100,
      url: "https://dup.com",
      childIds: [200],
    });
    const b = createNode({ id: 200, url: "https://dup.com", parentId: 100 });
    const savedTree: TreeState = { nodes: { 100: a, 200: b }, rootIds: [100] };

    const actualTabs = [
      actualTab({ id: 1, url: "https://dup.com" }),
      actualTab({ id: 2, url: "https://dup.com" }),
    ];

    const result = restoreTree(savedTree, actualTabs);

    expect(result.rootIds).toEqual([1]);
    expect(result.nodes[1]?.childIds).toEqual([2]);
    expect(result.nodes[2]?.parentId).toBe(1);
  });

  it("treats extra same-url actual tabs beyond the saved count as new roots", () => {
    const a = createNode({ id: 100, url: "https://dup.com" });
    const savedTree: TreeState = { nodes: { 100: a }, rootIds: [100] };

    const actualTabs = [
      actualTab({ id: 1, url: "https://dup.com" }),
      actualTab({ id: 2, url: "https://dup.com" }),
    ];

    const result = restoreTree(savedTree, actualTabs);

    expect(result.rootIds).toEqual([1, 2]);
    expect(result.nodes[2]?.parentId).toBeNull();
  });

  it("returns an empty tree when no actual tabs are open", () => {
    const a = createNode({ id: 100, url: "https://a.com" });
    const savedTree: TreeState = { nodes: { 100: a }, rootIds: [100] };

    const result = restoreTree(savedTree, []);

    expect(result).toEqual({ nodes: {}, rootIds: [] });
  });
});

describe("matchStraggler", () => {
  it("matches a straggler against the saved node restoreTree didn't consume, using its resolved parent", () => {
    // Saved: A(id=100) -> B(id=200). Only A shows up in the initial batch;
    // B arrives later, as a straggler.
    const a = createNode({ id: 100, url: "https://a.com", childIds: [200] });
    const b = createNode({ id: 200, url: "https://b.com", parentId: 100 });
    const savedTree: TreeState = { nodes: { 100: a, 200: b }, rootIds: [100] };

    const session = createRestoreSession(savedTree);
    restoreTree(
      savedTree,
      [actualTab({ id: 1, url: "https://a.com" })],
      session,
    );

    const straggler = matchStraggler(
      session,
      actualTab({ id: 2, url: "https://b.com" }),
    );

    expect(straggler).toEqual({ parentId: 1 });
  });

  it("returns undefined for a url with no leftover saved node", () => {
    const a = createNode({ id: 100, url: "https://a.com" });
    const savedTree: TreeState = { nodes: { 100: a }, rootIds: [100] };

    const session = createRestoreSession(savedTree);
    restoreTree(
      savedTree,
      [actualTab({ id: 1, url: "https://a.com" })],
      session,
    );

    const straggler = matchStraggler(
      session,
      actualTab({ id: 2, url: "https://unrelated.com" }),
    );

    expect(straggler).toBeUndefined();
  });

  it("resolves a straggler's parent to another straggler matched just before it", () => {
    // Saved: A(id=100) -> B(id=200). Neither shows up in the initial batch;
    // both arrive later, as stragglers, parent first.
    const a = createNode({ id: 100, url: "https://a.com", childIds: [200] });
    const b = createNode({ id: 200, url: "https://b.com", parentId: 100 });
    const savedTree: TreeState = { nodes: { 100: a, 200: b }, rootIds: [100] };

    const session = createRestoreSession(savedTree);
    restoreTree(savedTree, [], session);

    matchStraggler(session, actualTab({ id: 1, url: "https://a.com" }));
    const straggler = matchStraggler(
      session,
      actualTab({ id: 2, url: "https://b.com" }),
    );

    expect(straggler).toEqual({ parentId: 1 });
  });

  it("falls parentless when a straggler's saved parent hasn't shown up yet", () => {
    const a = createNode({ id: 100, url: "https://a.com", childIds: [200] });
    const b = createNode({ id: 200, url: "https://b.com", parentId: 100 });
    const savedTree: TreeState = { nodes: { 100: a, 200: b }, rootIds: [100] };

    const session = createRestoreSession(savedTree);
    restoreTree(savedTree, [], session);

    const straggler = matchStraggler(
      session,
      actualTab({ id: 2, url: "https://b.com" }),
    );

    expect(straggler).toEqual({ parentId: null });
  });
});
