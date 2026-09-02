import type { ActualTab } from "./restore";
import { flattenDepthFirst } from "./queries";
import type { TreeState } from "./types";

/**
 * A window's saved tree, keyed by the window id it was saved under before
 * the browser restarted.
 */
export interface SavedWindow {
  windowId: number;
  tree: TreeState;
}

/**
 * A window actually open right now, with the tabs it currently contains.
 */
export interface ActualWindow {
  windowId: number;
  tabs: ActualTab[];
}

/**
 * The saved tree resolved for one actual window by `matchWindows`, along
 * with which saved window (if any) it was matched to.
 */
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

// Below this fraction of overlap (relative to the union of both tab sets), a
// candidate is treated as no match at all rather than merely a weak one—e.g.
// one shared tab out of a hundred is almost certainly coincidence (the same
// site open in two unrelated windows), not the same window. Scoring by plain
// overlap count instead of this ratio would let a single-tab window win a
// match against a large window over a genuinely unrelated one just because
// nothing else scored higher, which is exactly the failure this guards
// against—while a ratio still lets two small windows match on a single
// shared tab (see the tests), since that pair's ratio is 100%.
const MIN_OVERLAP_RATIO = 0.1;

function scoreCandidate(
  savedUrlSet: Set<string> | undefined,
  actualUrlSet: Set<string> | undefined,
): number {
  if (savedUrlSet === undefined || actualUrlSet === undefined) {
    return 0;
  }
  const overlap = countOverlap(savedUrlSet, actualUrlSet);
  if (overlap === 0) {
    return 0;
  }
  const unionSize = savedUrlSet.size + actualUrlSet.size - overlap;
  const ratio = overlap / unionSize;
  return ratio < MIN_OVERLAP_RATIO ? 0 : ratio;
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
    savedWindowId: number;
  }[] = [];
  for (const [savedIndex, savedWindow] of savedWindows.entries()) {
    for (let actualIndex = 0; actualIndex < actualWindows.length; actualIndex++) {
      const score = scoreCandidate(
        savedUrlSets[savedIndex],
        actualUrlSets[actualIndex],
      );
      if (score > 0) {
        candidates.push({
          savedIndex,
          actualIndex,
          score,
          savedWindowId: savedWindow.windowId,
        });
      }
    }
  }
  // A saved window whose structure changed (a tab reparented or reordered)
  // but whose tab *set* stayed the same scores identically to a stale
  // duplicate left over from before that change (see
  // `initializeAllWindows`'s matched-window cleanup in
  // `background/index.ts`, which only stops new duplicates from
  // accumulating, not ones already sitting in storage)—URL overlap alone
  // can't break that tie. Left to plain array order, the
  // stale duplicate would win: it's built first here since `loadAllTrees`
  // iterates its object's keys in ascending numeric order, and
  // `Array.prototype.sort` is stable. Preferring the larger windowId—Chrome
  // assigns those in increasing creation order—instead makes the more
  // recently saved candidate win, which is what a tie should mean.
  candidates.sort(
    (a, b) => b.score - a.score || b.savedWindowId - a.savedWindowId,
  );

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
