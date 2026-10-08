import { moveNode } from "../shared/tree/mutations";
import { flattenDepthFirst } from "../shared/tree/queries";
import type { TreeState } from "../shared/tree/types";
import { getTree } from "./store";

// How long to wait, after registering a tree move, for every expected tab
// to finish attaching to its destination window before giving up on
// reconstructing the rest of the batch’s structure. Each attached tab has
// already landed as an independent root by then (see `handleTabAttached`’s
// own `addTab` call), so abandoning the batch just leaves it flattened
// rather than losing anything.
const SAFETY_TIMEOUT_MS = 2000;

interface PendingTreeMove {
  // Depth-first order of the tabs being moved together, as they stood in
  // the source tree at registration time—so reparenting reproduces their
  // original relative order once they land.
  orderedIds: number[];
  // Each id’s parent among this same moving set—or `null` if it should
  // land as a root (it had no parent, or its parent isn’t part of this
  // move).
  parentIds: Map<number, number | null>;
  seenIds: Set<number>;
  timer: ReturnType<typeof setTimeout>;
}

// A single mutable slot rather than a top-level `let`—`unicorn/no-top-level-
// assignment-in-function` disallows reassigning a top-level variable from
// inside a function, so state that needs updating from `registerPending
// TreeMove`/`noteTreeMoveAttached` has to live behind a stable reference
// instead (same reason `pending-close.ts` keeps its batches in a `Map`
// rather than a reassigned variable).
const slot: { pending: PendingTreeMove | null } = { pending: null };

/**
 * Declares a set of tabs the side panel is about to move together to
 * another window, ahead of the corresponding `chrome.tabs.move`/
 * `chrome.windows.create` calls—captures their current parent/child
 * relationships (restricted to this same set) so `noteTreeMoveAttached` can
 * reconstruct them once every one has landed in the destination window,
 * instead of each becoming an independent root there.
 */
export function registerPendingTreeMove(
  tree: TreeState,
  tabIds: number[],
): void {
  if (slot.pending !== null) {
    clearTimeout(slot.pending.timer);
  }

  const idSet = new Set(tabIds);
  const orderedIds = flattenDepthFirst(tree)
    .map((node) => node.id)
    .filter((id) => idSet.has(id));
  const parentIds = new Map<number, number | null>();
  for (const id of orderedIds) {
    const parentId = tree.nodes[id]?.parentId ?? null;
    parentIds.set(
      id,
      parentId !== null && idSet.has(parentId) ? parentId : null,
    );
  }

  slot.pending = {
    orderedIds,
    parentIds,
    seenIds: new Set(),
    timer: setTimeout(() => {
      slot.pending = null;
    }, SAFETY_TIMEOUT_MS),
  };
}

/**
 * Records that `tabId` just attached to `newWindowId` as part of an
 * in-flight `registerPendingTreeMove` batch. Once every expected tab has
 * been seen, reconstructs their original relative parent/child structure
 * and returns the resulting tree for the caller to `setTree`/`saveTree`/
 * `syncNativeOrder`. Returns `undefined` if `tabId` isn’t part of a pending
 * batch, or the batch isn’t complete yet.
 */
export function noteTreeMoveAttached(
  tabId: number,
  newWindowId: number,
): TreeState | undefined {
  if (slot.pending === null || !slot.pending.parentIds.has(tabId)) {
    return undefined;
  }

  slot.pending.seenIds.add(tabId);
  if (slot.pending.seenIds.size < slot.pending.parentIds.size) {
    return undefined;
  }

  const batch = slot.pending;
  slot.pending = null;
  clearTimeout(batch.timer);

  let tree = getTree(newWindowId);
  for (const id of batch.orderedIds) {
    const parentId = batch.parentIds.get(id) ?? null;
    if (parentId !== null) {
      tree = moveNode(tree, id, { targetId: parentId, position: "child" });
    }
  }
  return tree;
}
