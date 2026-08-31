import { describe, expect, it } from "vitest";
import {
  matchWindows,
  type ActualWindow,
  type SavedWindow,
} from "./window-matching";
import { createNode } from "./test-helpers";
import type { TreeState } from "./types";

function tree(...urls: string[]): TreeState {
  const nodes: TreeState["nodes"] = {};
  const rootIds: number[] = [];
  for (const [index, url] of urls.entries()) {
    const id = index + 1;
    nodes[id] = createNode({ id, url });
    rootIds.push(id);
  }
  return { nodes, rootIds };
}

function actualWindow(windowId: number, ...urls: string[]): ActualWindow {
  return {
    windowId,
    tabs: urls.map((url, index) => ({
      id: index + 1,
      url,
      title: url,
      favIconUrl: undefined,
      pinned: false,
      loading: false,
      suspended: false,
      audible: false,
    })),
  };
}

describe("matchWindows", () => {
  it("matches a single saved window to a single actual window by url overlap", () => {
    const saved: SavedWindow[] = [
      { windowId: 100, tree: tree("https://a.com", "https://b.com") },
    ];
    const actual: ActualWindow[] = [
      actualWindow(1, "https://a.com", "https://b.com"),
    ];

    const result = matchWindows(saved, actual);

    expect(result).toEqual([
      { actualWindowId: 1, savedWindowId: 100, savedTree: saved[0]?.tree },
    ]);
  });

  it("prefers the saved window with the highest url overlap", () => {
    const saved: SavedWindow[] = [
      { windowId: 100, tree: tree("https://a.com") },
      {
        windowId: 200,
        tree: tree("https://a.com", "https://b.com", "https://c.com"),
      },
    ];
    const actual: ActualWindow[] = [
      actualWindow(1, "https://a.com", "https://b.com"),
    ];

    const result = matchWindows(saved, actual);

    expect(result[0]?.savedWindowId).toBe(200);
  });

  it("matches multiple windows one-to-one, not letting one saved window match twice", () => {
    const saved: SavedWindow[] = [
      { windowId: 100, tree: tree("https://a.com") },
      { windowId: 200, tree: tree("https://b.com") },
    ];
    const actual: ActualWindow[] = [
      actualWindow(1, "https://b.com"),
      actualWindow(2, "https://a.com"),
    ];

    const result = matchWindows(saved, actual);

    expect(result.find((m) => m.actualWindowId === 1)?.savedWindowId).toBe(200);
    expect(result.find((m) => m.actualWindowId === 2)?.savedWindowId).toBe(100);
  });

  it("gives an actual window with no overlapping saved window an empty tree", () => {
    const saved: SavedWindow[] = [
      { windowId: 100, tree: tree("https://a.com") },
    ];
    const actual: ActualWindow[] = [actualWindow(1, "https://new.com")];

    const result = matchWindows(saved, actual);

    expect(result).toEqual([
      {
        actualWindowId: 1,
        savedWindowId: undefined,
        savedTree: { nodes: {}, rootIds: [] },
      },
    ]);
  });

  it("leaves unmatched saved windows out of the result", () => {
    const saved: SavedWindow[] = [
      { windowId: 100, tree: tree("https://a.com") },
      { windowId: 200, tree: tree("https://gone.com") },
    ];
    const actual: ActualWindow[] = [actualWindow(1, "https://a.com")];

    const result = matchWindows(saved, actual);

    expect(result).toHaveLength(1);
    expect(result[0]?.savedWindowId).toBe(100);
  });

  it("matches two single-tab windows on their one shared tab", () => {
    const saved: SavedWindow[] = [
      { windowId: 100, tree: tree("https://a.com") },
    ];
    const actual: ActualWindow[] = [actualWindow(1, "https://a.com")];

    const result = matchWindows(saved, actual);

    expect(result[0]?.savedWindowId).toBe(100);
  });

  it("does not match a large window on a single tab shared with an otherwise unrelated saved window", () => {
    const saved: SavedWindow[] = [
      { windowId: 100, tree: tree("https://shared.com") },
    ];
    const manyUrls = Array.from(
      { length: 20 },
      (_, index) => `https://unrelated-${index}.com`,
    );
    const actual: ActualWindow[] = [
      actualWindow(1, "https://shared.com", ...manyUrls),
    ];

    const result = matchWindows(saved, actual);

    expect(result[0]?.savedWindowId).toBeUndefined();
    expect(result[0]?.savedTree).toEqual({ nodes: {}, rootIds: [] });
  });
});
