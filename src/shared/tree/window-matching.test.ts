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

// `savedAt` defaults to an arbitrary fixed value for tests that don't care
// about recency at all (i.e. where the raw score alone already decides).
function savedWindow(id: string, urls: string[], savedAt = 1000): SavedWindow {
  return { id, savedAt, tree: tree(...urls) };
}

describe("matchWindows", () => {
  it("matches a single saved window to a single actual window by url overlap", () => {
    const saved: SavedWindow[] = [
      savedWindow("100", ["https://a.com", "https://b.com"]),
    ];
    const actual: ActualWindow[] = [
      actualWindow(1, "https://a.com", "https://b.com"),
    ];

    const result = matchWindows(saved, actual);

    expect(result).toEqual([
      { actualWindowId: 1, savedId: "100", savedTree: saved[0]?.tree },
    ]);
  });

  it("prefers the saved window with the highest url overlap", () => {
    const saved: SavedWindow[] = [
      savedWindow("100", ["https://a.com"]),
      savedWindow("200", ["https://a.com", "https://b.com", "https://c.com"]),
    ];
    const actual: ActualWindow[] = [
      actualWindow(1, "https://a.com", "https://b.com"),
    ];

    const result = matchWindows(saved, actual);

    expect(result[0]?.savedId).toBe("200");
  });

  it("matches multiple windows one-to-one, not letting one saved window match twice", () => {
    const saved: SavedWindow[] = [
      savedWindow("100", ["https://a.com"]),
      savedWindow("200", ["https://b.com"]),
    ];
    const actual: ActualWindow[] = [
      actualWindow(1, "https://b.com"),
      actualWindow(2, "https://a.com"),
    ];

    const result = matchWindows(saved, actual);

    expect(result.find((m) => m.actualWindowId === 1)?.savedId).toBe("200");
    expect(result.find((m) => m.actualWindowId === 2)?.savedId).toBe("100");
  });

  it("gives an actual window with no overlapping saved window an empty tree", () => {
    const saved: SavedWindow[] = [savedWindow("100", ["https://a.com"])];
    const actual: ActualWindow[] = [actualWindow(1, "https://new.com")];

    const result = matchWindows(saved, actual);

    expect(result).toEqual([
      {
        actualWindowId: 1,
        savedId: undefined,
        savedTree: { nodes: {}, rootIds: [] },
      },
    ]);
  });

  it("leaves unmatched saved windows out of the result", () => {
    const saved: SavedWindow[] = [
      savedWindow("100", ["https://a.com"]),
      savedWindow("200", ["https://gone.com"]),
    ];
    const actual: ActualWindow[] = [actualWindow(1, "https://a.com")];

    const result = matchWindows(saved, actual);

    expect(result).toHaveLength(1);
    expect(result[0]?.savedId).toBe("100");
  });

  it("matches two single-tab windows on their one shared tab", () => {
    const saved: SavedWindow[] = [savedWindow("100", ["https://a.com"])];
    const actual: ActualWindow[] = [actualWindow(1, "https://a.com")];

    const result = matchWindows(saved, actual);

    expect(result[0]?.savedId).toBe("100");
  });

  it("breaks a tied score by preferring the more recently *saved* window, not array order or id", () => {
    const saved: SavedWindow[] = [
      // First in array, and the id that sorts first—both deliberately wrong
      // signals to win on, so this catches a tie-break that falls back to
      // array/insertion order or to id instead of `savedAt`.
      savedWindow("a", ["https://a.com", "https://b.com"], 1000),
      savedWindow("b", ["https://a.com", "https://b.com"], 2000),
    ];
    const actual: ActualWindow[] = [
      actualWindow(1, "https://a.com", "https://b.com"),
    ];

    const result = matchWindows(saved, actual);

    expect(result[0]?.savedId).toBe("b");
  });

  it("breaks a tie on both score and `savedAt` by id, regardless of array order", () => {
    const actual: ActualWindow[] = [
      actualWindow(1, "https://a.com", "https://b.com"),
    ];
    const urls = ["https://a.com", "https://b.com"];

    const forward = matchWindows(
      [savedWindow("a", urls), savedWindow("b", urls)],
      actual,
    );
    const reversed = matchWindows(
      [savedWindow("b", urls), savedWindow("a", urls)],
      actual,
    );

    expect(forward[0]?.savedId).toBe("a");
    expect(reversed[0]?.savedId).toBe("a");
  });

  it("prefers the more recently saved window over a marginally higher-scoring older one (within the tie-break epsilon)", () => {
    const shared = Array.from(
      { length: 100 },
      (_, index) => `https://shared-${index}.com`,
    );
    const actual: ActualWindow[] = [actualWindow(1, ...shared)];

    const saved: SavedWindow[] = [
      // Older save, a hair higher raw score (91/100 shared urls plus 9
      // stray ones, ratio 91/109 ≈ 0.835)—and the id that sorts first, so
      // recency must come from `savedAt`, not from the id tie-break.
      {
        id: "a",
        savedAt: 1000,
        tree: tree(
          ...shared.slice(0, 91),
          ...Array.from(
            { length: 9 },
            (_, index) => `https://older-only-${index}.com`,
          ),
        ),
      },
      // Newer save, marginally lower raw score (90/100 shared urls plus 10
      // stray ones, ratio 90/110 ≈ 0.818)—within `SCORE_TIE_EPSILON` of the
      // older window's score, so recency should decide instead.
      {
        id: "b",
        savedAt: 5000,
        tree: tree(
          ...shared.slice(0, 90),
          ...Array.from(
            { length: 10 },
            (_, index) => `https://newer-only-${index}.com`,
          ),
        ),
      },
    ];

    const result = matchWindows(saved, actual);

    expect(result[0]?.savedId).toBe("b");
  });

  it("does not let recency override a meaningfully better-scoring window (score gap beyond the tie-break epsilon)", () => {
    const shared = Array.from(
      { length: 100 },
      (_, index) => `https://shared-${index}.com`,
    );
    const actual: ActualWindow[] = [actualWindow(1, ...shared)];

    const saved: SavedWindow[] = [
      // Higher raw score (90/100 shared, ratio 90/110 ≈ 0.818) but an older
      // save—recency shouldn't be able to override a genuinely better url
      // match this large.
      {
        id: "higher",
        savedAt: 1000,
        tree: tree(
          ...shared.slice(0, 90),
          ...Array.from(
            { length: 10 },
            (_, index) => `https://higher-only-${index}.com`,
          ),
        ),
      },
      // A more recent save, but a much weaker match (70/100 shared, ratio
      // 70/130 ≈ 0.538).
      {
        id: "lower",
        savedAt: 5000,
        tree: tree(
          ...shared.slice(0, 70),
          ...Array.from(
            { length: 30 },
            (_, index) => `https://lower-only-${index}.com`,
          ),
        ),
      },
    ];

    const result = matchWindows(saved, actual);

    expect(result[0]?.savedId).toBe("higher");
  });

  it("does not match a large window on a single tab shared with an otherwise unrelated saved window", () => {
    const saved: SavedWindow[] = [savedWindow("100", ["https://shared.com"])];
    const manyUrls = Array.from(
      { length: 20 },
      (_, index) => `https://unrelated-${index}.com`,
    );
    const actual: ActualWindow[] = [
      actualWindow(1, "https://shared.com", ...manyUrls),
    ];

    const result = matchWindows(saved, actual);

    expect(result[0]?.savedId).toBeUndefined();
    expect(result[0]?.savedTree).toEqual({ nodes: {}, rootIds: [] });
  });
});
