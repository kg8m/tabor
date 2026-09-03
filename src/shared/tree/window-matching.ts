import type { ActualTab } from "./restore";
import { flattenDepthFirst } from "./queries";
import type { TreeState } from "./types";

/**
 * A window's saved tree, keyed by the window id it was saved under before
 * the browser restarted, along with when it was last saved (see
 * `StoredTree`)—used to prefer a more recently saved candidate when two
 * score close to each other (see `SCORE_TIE_EPSILON`).
 */
export interface SavedWindow {
  windowId: number;
  tree: TreeState;
  savedAt: number;
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

// How close two candidates' scores must be, in absolute ratio terms, before
// recency (`savedAt`, see `SavedWindow`) decides between them instead of
// trusting the raw score's exact ordering—see the comment on
// `candidates.sort` below for why a plain equality check isn't enough. Two
// saved snapshots of the very same real window, taken at different times,
// rarely score identically even though they represent the same window: a
// single tab that was only open transiently in one of the two snapshots is
// enough to separate their overlap ratios by a few percentage points.
// Deliberately modest—small enough that a genuinely better url match (e.g.
// most of a window's tabs vs. a small fraction of them) still wins purely on
// its own merits.
const SCORE_TIE_EPSILON = 0.05;

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
    savedAt: number;
  }[] = [];
  for (const [savedIndex, savedWindow] of savedWindows.entries()) {
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
        candidates.push({
          savedIndex,
          actualIndex,
          score,
          savedWindowId: savedWindow.windowId,
          savedAt: savedWindow.savedAt,
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
  // can't break that tie, nor can it separate two snapshots of the same
  // window that merely score close to each other rather than identically
  // (see `SCORE_TIE_EPSILON`). Left to plain array order, the stale
  // duplicate would win: it's built first here since `loadAllTrees` iterates
  // its object's keys in ascending numeric order, and `Array.prototype.sort`
  // is stable. Preferring the more recently *saved* candidate (`savedAt`)
  // instead makes the actually-current one win, which is what a near-tie
  // should mean.
  //
  // Deliberately `savedAt`, not `savedWindowId`: a window id only increases
  // within a single running browser process and resets to a small number on
  // every real restart (see `StoredTree`), so a saved tree from a long-lived
  // earlier session can carry a *larger* id than one saved moments ago in
  // the current one—comparing ids across that boundary would silently
  // prefer the older tree. `savedWindowId` remains only as a final,
  // deterministic tiebreak below, for the vanishingly unlikely case two
  // candidates share the exact same `savedAt` millisecond.
  //
  // Scores are bucketed (by `SCORE_TIE_EPSILON` width) rather than compared
  // pairwise ("is |a.score - b.score| within epsilon?") so this stays a
  // strict, transitive ordering: with more than two candidates, a pairwise
  // check can rank A before B, B before C, yet C before A—`Array.sort` isn't
  // required to produce any particular result once a comparator does that.
  // Flooring each score into its bucket first, then comparing
  // (bucket, savedAt, id) tuples, can't run into that—it's an ordinary
  // lexicographic order.
  candidates.sort((a, b) => {
    const bucketDiff =
      Math.floor(b.score / SCORE_TIE_EPSILON) -
      Math.floor(a.score / SCORE_TIE_EPSILON);
    return bucketDiff || b.savedAt - a.savedAt || b.savedWindowId - a.savedWindowId;
  });

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
