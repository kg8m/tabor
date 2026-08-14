import type { ActualTab } from "./restore";
import { flattenDepthFirst } from "./queries";
import type { TreeState } from "./types";

export interface SavedWindow {
  windowId: number;
  tree: TreeState;
}

export interface ActualWindow {
  windowId: number;
  tabs: ActualTab[];
}

export interface WindowMatch {
  actualWindowId: number;
  savedWindowId: number | undefined;
  savedTree: TreeState;
}

const EMPTY_TREE: TreeState = { nodes: {}, rootIds: [] };

function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const url of a) {
    if (b.has(url)) {
      count += 1;
    }
  }
  return count;
}

function scoreCandidate(
  savedUrlSet: Set<string> | undefined,
  actualUrlSet: Set<string> | undefined,
): number {
  if (savedUrlSet === undefined || actualUrlSet === undefined) {
    return 0;
  }
  return countOverlap(savedUrlSet, actualUrlSet);
}

/**
 * Match saved windows to the windows actually open at startup, since window
 * ids (like tab ids) don't survive a browser restart.
 *
 * Windows are paired by tab URL overlap, greedily taking the
 * highest-overlap pairs first. An actual window with no good match (or no
 * saved windows left) gets an empty tree, to be built up fresh. A saved
 * window with no matching actual window is simply left out of the result;
 * the caller is expected to clean up its storage entry.
 */
export function matchWindows(
  savedWindows: SavedWindow[],
  actualWindows: ActualWindow[],
): WindowMatch[] {
  const savedUrlSets = savedWindows.map(
    (saved) => new Set(flattenDepthFirst(saved.tree).map((node) => node.url)),
  );
  const actualUrlSets = actualWindows.map(
    (actual) => new Set(actual.tabs.map((tab) => tab.url)),
  );

  const candidates: {
    savedIndex: number;
    actualIndex: number;
    score: number;
  }[] = [];
  for (let savedIndex = 0; savedIndex < savedWindows.length; savedIndex++) {
    for (
      let actualIndex = 0;
      actualIndex < actualWindows.length;
      actualIndex++
    ) {
      const score = scoreCandidate(
        savedUrlSets[savedIndex],
        actualUrlSets[actualIndex],
      );
      if (score > 0) {
        candidates.push({ savedIndex, actualIndex, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const savedIndexByActualIndex = new Map<number, number>();
  const usedSavedIndices = new Set<number>();
  const usedActualIndices = new Set<number>();

  for (const candidate of candidates) {
    if (
      usedSavedIndices.has(candidate.savedIndex) ||
      usedActualIndices.has(candidate.actualIndex)
    ) {
      continue;
    }
    usedSavedIndices.add(candidate.savedIndex);
    usedActualIndices.add(candidate.actualIndex);
    savedIndexByActualIndex.set(candidate.actualIndex, candidate.savedIndex);
  }

  return actualWindows.map((actualWindow, actualIndex) => {
    const savedIndex = savedIndexByActualIndex.get(actualIndex);
    const saved =
      savedIndex === undefined ? undefined : savedWindows[savedIndex];

    return {
      actualWindowId: actualWindow.windowId,
      savedWindowId: saved?.windowId,
      savedTree: saved?.tree ?? EMPTY_TREE,
    };
  });
}
